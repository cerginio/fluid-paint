// message-api.js
// Symmetric multi-peer MessageAPI over window.postMessage
// Supports: hello/ready (retry), RPC (call/expose), chunked streams w/ windowing+ack, transferables.
// Works for: Host (main window with many iframes) and Embedded (iframe talking to parent or opener).

function createMessageApi({
    channel = "story-platform",          // logical channel namespace
    role,                                 // "editor" | "gamificator" | ...
    selfId = null,                        // optional stable id for this app instance
    allowedOrigins = [],                  // if non-empty, only accept messages from these origins
    targetOrigin = null,                  // required for sending (e.g., "https://example.com")
    debug = false,
    preferBinary = "arraybuffer",         // "arraybuffer" | "base64"
    maxChunkBytes = 256 * 1024,
    windowSize = 8,
    maxOutgoingBytes = Number.POSITIVE_INFINITY,
    maxIncomingBytes = Number.POSITIVE_INFINITY,
    acceptStreamOpen = null,
    protocolVersion = null,
    adoptSessionId = true,                // embedded can adopt host sessionId from hello
    reAdoptSessionOnHello = false,        // embedded peer may follow an authoritative parent restart
    helloRetries = 20,
    helloIntervalMs = 150,
  } = {}) {
    if (!role) throw new Error("MessageAPI: role is required");
    if (!targetOrigin) {
      // You *can* set later per-peer via addPeer(..., {origin})
      // But it's strongly recommended to have a default.
      // We'll allow null but enforce when sending.
    }

  /** TODO: better naming like PostMessageChannel, PostMessageRpcClient, PostMessagePeer  */
    const api = new MessageApiImpl({
      channel,
      role,
      selfId: selfId || uuid(),
      allowedOrigins,
      targetOrigin,
      debug,
      preferBinary,
      maxChunkBytes,
      windowSize,
      maxOutgoingBytes,
      maxIncomingBytes,
      acceptStreamOpen,
      protocolVersion,
      adoptSessionId,
      reAdoptSessionOnHello,
      helloRetries,
      helloIntervalMs
    });
  
    return api;
  } // << createMessageApi
  const defaultTimeout = 2500;
  class MessageApiImpl {
    constructor(cfg) {
      Object.assign(this, cfg);
  
      this.sessionId = uuid(); // may be adopted from hello if desired
      this.handlers = new Map();        // eventName -> Set(fn)
      this.rpcHandlers = new Map();     // type -> fn(payload, envelope, peer) => result
      this.pending = new Map();         // msgId -> {resolve,reject,timeoutId}
  
      // peers: peerId -> { win, origin, ready, lastHelloAt, meta }
      this.peers = new Map();
  
      // streams
      this.rxStreams = new Map();       // streamId -> rxState
      this.txStreams = new Map();       // streamId -> txState
  
      this._onMessage = this._onMessage.bind(this);
      window.addEventListener("message", this._onMessage);
    }
  
    /* ---------------- Events ---------------- */
  
    on(eventName, fn) {
      if (!this.handlers.has(eventName)) this.handlers.set(eventName, new Set());
      this.handlers.get(eventName).add(fn);
      return () => this.off(eventName, fn);
    }
    off(eventName, fn) { this.handlers.get(eventName)?.delete(fn); }
    emit(eventName, payload) {
      const set = this.handlers.get(eventName);
      if (!set) return;
      for (const fn of set) {
        try { fn(payload); } catch { /* swallow */ }
      }
    }
  
    /* ---------------- Lifecycle ---------------- */
  
    dispose() {
      window.removeEventListener("message", this._onMessage);
  
      for (const { timeoutId } of this.pending.values()) clearTimeout(timeoutId);
      this.pending.clear();
  
      for (const peer of this.peers.values()) {
        if (peer.helloTimer) clearInterval(peer.helloTimer);
      }
      this.peers.clear();
      this.rxStreams.clear();
      this.txStreams.clear();
  
      this.handlers.clear();
      this.rpcHandlers.clear();
    }
  
    /* ---------------- Peer management ---------------- */
  
    /**
     * Register a peer window (iframe.contentWindow, window.parent, window.opener, etc.)
     * @param {string} peerId - stable identifier you assign (e.g. iframe dataset id)
     * @param {Window} win
     * @param {object} opts { origin?: string, meta?: object, autoHello?: boolean }
     */
    addPeer(peerId, win, opts = {}) {
      if (!peerId) throw new Error("addPeer: peerId required");
      if (!win) throw new Error("addPeer: window required");
  
      const origin = opts.origin ?? this.targetOrigin;
      const peer = {
        peerId,
        win,
        origin,
        ready: false,
        meta: opts.meta || {},
        lastHelloAt: 0,
        helloTimer: null
      };
      this.peers.set(peerId, peer);
  
      if (opts.autoHello !== false) {
        // fire-and-forget; user can also await waitReady(peerId)
        this._startHello(peerId);
      }
      return peerId;
    }
  
    removePeer(peerId) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      if (peer.helloTimer) {
        clearInterval(peer.helloTimer);
        peer.helloTimer = null;
      }
      this.peers.delete(peerId);
    }
  
    getPeer(peerId) { return this.peers.get(peerId) || null; }
  
    /**
     * Embedded convenience: register parent as a peer.
     * Useful inside iframe: api.addParentPeer("host")
     */
    addParentPeer(peerId = "host", opts = {}) {
      // In iframe, window.parent exists; in popup, maybe window.opener
      const win = window.parent || window.opener;
      if (!win) throw new Error("addParentPeer: no parent/opener window");
      return this.addPeer(peerId, win, opts);
    }
  
    /**
     * Wait until peer is ready (hello handshake completed).
     */
    // async waitReady(peerId, timeoutMs = 8000) {
    //   const peer = this.peers.get(peerId);
    //   if (!peer) throw new Error(`waitReady: unknown peerId ${peerId}`);
    //   if (peer.ready) return true;
  
    //   return new Promise((resolve, reject) => {
    //     const off = this.on("peer:ready", (p) => {
    //       if (p.peerId !== peerId) return;
    //       off();
    //       clearTimeout(t);
    //       resolve(true);
    //     });
    //     const t = setTimeout(() => {
    //       off();
    //       reject(new Error(`MessageAPI: timed out waiting peer ready (${peerId})`));
    //     }, timeoutMs);
    //   });
    // }
  

    async waitReady(peerId, timeoutMs = defaultTimeout, { retryHello = true, retryIntervalMs = 250 } = {}) {
      const peer = this.peers.get(peerId);
      if (!peer) throw new Error(`waitReady: unknown peerId ${peerId}`);
      if (peer.ready) return true;
    
      // ✅ optional: make sure hello retry is running
      let retryTimer = null;
      if (retryHello) {
        retryTimer = setInterval(() => {
          const p = this.peers.get(peerId);
          if (!p || p.ready) return;
          this._sendToPeer(peerId, "hello", {
            sessionId: this.sessionId,
            selfId: this.selfId,
            role: this.role,
            protocolVersion: this.protocolVersion,
            ts: Date.now()
          });
        }, retryIntervalMs);
      }
    
      return new Promise((resolve, reject) => {
        const off = this.on("peer:ready", (p) => {
          if (p.peerId !== peerId) return;
          cleanup();
          resolve(true);
        });
    
        const t = setTimeout(() => {
          cleanup();
          reject(new Error(`MessageAPI: timed out waiting peer ready (${peerId})`));
        }, timeoutMs);
    
        const cleanup = () => {
          off();
          clearTimeout(t);
          if (retryTimer) clearInterval(retryTimer);
        };
      });
    }

    _startHello(peerId) {
      const peer = this.peers.get(peerId);
      if (!peer) return;
  
      if (peer.helloTimer) clearInterval(peer.helloTimer);
  
      let attempts = 0;
      peer.helloTimer = setInterval(() => {
        if (!this.peers.has(peerId)) return;
        if (peer.ready) {
          clearInterval(peer.helloTimer);
          peer.helloTimer = null;
          return;
        }
        attempts++;
        this._sendToPeer(peerId, "hello", {
          sessionId: this.sessionId,
          selfId: this.selfId,
          role: this.role,
          protocolVersion: this.protocolVersion,
          // app meta, optional:
          ts: Date.now()
        });
        peer.lastHelloAt = Date.now();
  
        if (attempts >= this.helloRetries) {
          clearInterval(peer.helloTimer);
          peer.helloTimer = null;
          this.emit("peer:timeout", { peerId, attempts });
        }
      }, this.helloIntervalMs);
  
      // send immediately
      this._sendToPeer(peerId, "hello", {
        sessionId: this.sessionId,
        selfId: this.selfId,
        role: this.role,
        protocolVersion: this.protocolVersion,
        ts: Date.now()
      });
    }
  
    /* ---------------- App-level RPC ---------------- */
  
    expose(type, fn) {
      if (!type || typeof fn !== "function") throw new Error("expose(type, fn) invalid args");
      this.rpcHandlers.set(type, fn);
      return () => this.rpcHandlers.delete(type);
    }
  
    call(peerId, type, payload, { timeoutMs = defaultTimeout } = {}) {
      return this._rpc(peerId, type, payload, { timeoutMs });
    }
  
    /* ---------------- Streams ---------------- */
  
    async sendStream(peerId, data, opts = {}) {
      await this.waitReady(peerId, opts.readyTimeoutMs ?? defaultTimeout);
  
      const streamId = uuid();
      const kind = opts.kind || "asset";
      const mime = opts.mime || "application/octet-stream";
      const name = opts.name || `${kind}-${streamId}`;
      const chunkBytes = clampInt(opts.chunkBytes ?? this.maxChunkBytes, 16 * 1024, 1024 * 1024);
      const encoding = opts.encoding || this._chooseEncoding(opts.preferBinary);
  
      const bytes = await toUint8Array(data, { stringIsUtf8: !!opts.stringIsUtf8 });
      const size = bytes.byteLength;

      const outgoingLimit = opts.maxBytes ?? this.maxOutgoingBytes;
      if (Number.isFinite(outgoingLimit) && size > outgoingLimit) {
        throw streamPolicyError("STREAM_TOO_LARGE", `Outgoing stream exceeds ${outgoingLimit} bytes`, {
          limitBytes: outgoingLimit,
          actualBytes: size,
          kind
        });
      }
  
      const sha256 = opts.sha256 || (opts.hash === false ? null : await sha256Hex(bytes));
  
      const totalChunks = Math.max(1, Math.ceil(size / chunkBytes));
  
      // open
      await this._rpc(peerId, "stream.open", {
        streamId, kind, mime, name, size, chunkBytes, totalChunks,
        sha256,
        meta: opts.meta || {},
        directives: opts.directives || {}
      }, { timeoutMs: opts.timeoutMs ?? defaultTimeout });
  
      // tx state
      const txState = {
        peerId,
        streamId,
        bytes,
        size,
        chunkBytes,
        totalChunks,
        encoding,
        inFlight: new Set(),
        acked: new Set(),
        nextSeq: 0,
        done: false,
        // per-stream timeout optional
        startedAt: Date.now()
      };
      this.txStreams.set(streamId, txState);
  
      try {
        await this._sendChunksWithWindowing(txState, {
          timeoutMs: opts.streamTimeoutMs ?? 30000
        });

        // A successful close acknowledgement means the receiver assembled and verified it.
        const closeResult = await this._rpc(peerId, "stream.close", {
          streamId,
          lastSeq: totalChunks - 1,
          sha256,
          finalize: true
        }, { timeoutMs: opts.timeoutMs ?? defaultTimeout });

        return {
          streamId,
          delivered: closeResult?.delivered === true,
          verified: closeResult?.verified === true,
          size: closeResult?.size ?? size,
          sha256: closeResult?.sha256 ?? sha256
        };
      } finally {
        this.txStreams.delete(streamId);
      }
    }
  
    async sendJSON(peerId, obj, opts = {}) {
      const text = JSON.stringify(obj);
      return this.sendStream(peerId, text, {
        ...opts,
        kind: opts.kind || "model",
        mime: opts.mime || "application/json",
        name: opts.name || "model.json",
        stringIsUtf8: true
      });
    }
  
    async sendBlob(peerId, blob, opts = {}) {
      if (!(blob instanceof Blob)) throw new Error("sendBlob expects Blob");
      return this.sendStream(peerId, blob, opts);
    }
  
    /* ---------------- Internal: message receive ---------------- */
  
    _onMessage(ev) {
      try {
        // origin filtering
        if (this.allowedOrigins?.length) {
          if (!this.allowedOrigins.includes(ev.origin)) return;
        }
  
        const msg = ev.data;
        if (!msg || msg.__msgapi__ !== true) return;
        if (msg.channel !== this.channel) return;
  
        // identify peer by source window, fallback to peerId inside envelope
        const peer = this._resolvePeerFromEvent(ev, msg);
        if (!peer) return; // unknown source; ignore
  
        if (this.debug) console.debug("[msgapi] rx", msg.type, summarizeEnvelope(msg, peer));
  
        // hello handshake (window messages carry origin: good!)
        if (msg.type === "hello") return this._handleHello(peer, ev, msg);
        if (msg.type === "hello.ack") return this._handleHelloAck(peer, msg);
  
        // session scoping: allow hello messages to negotiate session; afterwards enforce sessionId
        if (peer.ready && msg.sessionId && msg.sessionId !== this.sessionId) {
          // if you want multi-session per peer, you can key peers by sessionId too.
          return;
        }
  
        // resolve pending RPC
        if ((msg.type === "ack" || msg.type === "error") && msg.replyTo) {
          const pending = this.pending.get(msg.replyTo);
          if (pending) {
            clearTimeout(pending.timeoutId);
            this.pending.delete(msg.replyTo);
            if (msg.type === "ack") pending.resolve(msg.payload);
            else pending.reject(Object.assign(new Error(msg.payload?.message || "RPC error"), { payload: msg.payload }));
          }
        }
  
        // stream acks (windowing)
        if (msg.type === "stream.ack") return this._handleStreamAck(peer, msg);
  
        // stream rx
        if (msg.type === "stream.open") return this._handleStreamOpen(peer, msg);
        if (msg.type === "stream.chunk") return this._handleStreamChunk(peer, msg);
        if (msg.type === "stream.close") return this._handleStreamClose(peer, msg);
  
        // app-level RPC dispatch
        const appHandler = this.rpcHandlers.get(msg.type);
        if (appHandler) {
          Promise.resolve()
            .then(() => appHandler(msg.payload, msg, peer))
            .then((res) => this._send(peer, "ack", res ?? { ok: true }, { replyTo: msg.id }))
            .catch((e) => this._send(peer, "error", { code: "RPC_HANDLER_ERROR", message: String(e) }, { replyTo: msg.id }));
          return;
        }
  
        // generic event
        this.emit(msg.type, { peerId: peer.peerId, payload: msg.payload, envelope: msg });
      } catch (e) {
        if (this.debug) console.warn("[msgapi] message handler error", e);
      }
    }
  
    _resolvePeerFromEvent(ev, msg) {
      // match by Window reference first
      for (const peer of this.peers.values()) {
        if (peer.win === ev.source) return peer;
      }
      // fallback: if sender included peerId and we have it
      if (msg.peerId && this.peers.has(msg.peerId)) return this.peers.get(msg.peerId);
      return null;
    }
  
    _handleHello(peer, ev, msg) {
      if (this.protocolVersion && msg.payload?.protocolVersion !== this.protocolVersion) {
        this.emit("peer:protocol-mismatch", {
          peerId: peer.peerId,
          expected: this.protocolVersion,
          received: msg.payload?.protocolVersion ?? null
        });
        return;
      }
      // Adopt sessionId if desired and if we are embedded or not yet ready.
      if (this.adoptSessionId && msg.payload?.sessionId && (!peer.ready || this.reAdoptSessionOnHello)) {
        this.sessionId = msg.payload.sessionId;
      }
  
      // store some meta
      peer.meta = {
        ...(peer.meta || {}),
        remoteSelfId: msg.payload?.selfId || null,
        remoteRole: msg.payload?.role || null,
        origin: ev.origin
      };
  
      // reply ack
      this._send(peer, "hello.ack", {
        sessionId: this.sessionId,
        selfId: this.selfId,
        role: this.role,
        protocolVersion: this.protocolVersion,
        ts: Date.now()
      });
  
      // Mark ready (we've seen them)
      if (!peer.ready) {
        peer.ready = true;
        this.emit("peer:ready", { peerId: peer.peerId, peer });
      }
    }
  
    _handleHelloAck(peer, msg) {
      if (this.protocolVersion && msg.payload?.protocolVersion !== this.protocolVersion) {
        this.emit("peer:protocol-mismatch", {
          peerId: peer.peerId,
          expected: this.protocolVersion,
          received: msg.payload?.protocolVersion ?? null
        });
        return;
      }
      // optionally adopt sessionId from ack (if host wants embedded to set it)
      if (this.adoptSessionId && msg.payload?.sessionId && !peer.ready) {
        this.sessionId = msg.payload.sessionId;
      }
  
      peer.meta = {
        ...(peer.meta || {}),
        remoteSelfId: msg.payload?.selfId || null,
        remoteRole: msg.payload?.role || null
      };
  
      if (!peer.ready) {
        peer.ready = true;
        this.emit("peer:ready", { peerId: peer.peerId, peer });
      }
    }
  
    /* ---------------- Internal: send / rpc ---------------- */
  
    _sendToPeer(peerId, type, payload, opts = {}) {
      const peer = this.peers.get(peerId);
      if (!peer) throw new Error(`Unknown peerId: ${peerId}`);
      return this._send(peer, type, payload, opts);
    }
  
    _send(peer, type, payload, { replyTo = null, transferables = [] } = {}) {
      const origin = peer.origin ?? this.targetOrigin;
      if (!origin) throw new Error("MessageAPI: targetOrigin required for sending");
  
      const envelope = {
        __msgapi__: true,
        channel: this.channel,
        sessionId: this.sessionId,
        peerId: peer.peerId,          // receiver can use as hint
        from: this.role,
        type,
        id: uuid(),
        replyTo,
        ts: Date.now(),
        payload: payload ?? {}
      };
  
      if (this.debug) console.debug("[msgapi] tx", type, summarizeEnvelope(envelope, peer));
  
      peer.win.postMessage(envelope, origin, transferables);
      return envelope.id;
    }
  
    _rpc(peerId, type, payload, { timeoutMs = defaultTimeout } = {}) {
      const peer = this.peers.get(peerId);
      if (!peer) throw new Error(`RPC: unknown peerId ${peerId}`);
  
      const messageId = this._send(peer, type, payload);
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pending.delete(messageId);
          reject(new Error(`MessageAPI RPC timeout: ${type}`));
        }, timeoutMs);
        this.pending.set(messageId, { resolve, reject, timeoutId });
      });
    }
  
    /* ---------------- Internal: streams RX ---------------- */
  
    _handleStreamOpen(peer, msg) {
      const p = msg.payload || {};
      const { streamId, totalChunks, size, chunkBytes } = p;
      if (!streamId || !Number.isSafeInteger(size) || size < 0 ||
          !Number.isInteger(chunkBytes) || chunkBytes < 16 * 1024 || chunkBytes > 1024 * 1024 ||
          !Number.isInteger(totalChunks) || totalChunks < 1 ||
          totalChunks !== Math.max(1, Math.ceil(size / chunkBytes))) {
        return this._send(peer, "error", { code: "BAD_STREAM_OPEN", message: "Invalid stream.open payload" }, { replyTo: msg.id });
      }

      const incomingLimit = this.maxIncomingBytes;
      if (Number.isFinite(incomingLimit) && size > incomingLimit) {
        return this._send(peer, "error", {
          code: "STREAM_TOO_LARGE",
          message: `Incoming stream exceeds ${incomingLimit} bytes`,
          limitBytes: incomingLimit,
          actualBytes: size,
          kind: p.kind
        }, { replyTo: msg.id });
      }

      if (typeof this.acceptStreamOpen === "function") {
        let decision;
        try {
          decision = this.acceptStreamOpen({ ...p, peerId: peer.peerId });
        } catch (error) {
          decision = { accepted: false, code: "STREAM_REFUSED", message: String(error?.message || error) };
        }
        if (decision === false || decision?.accepted === false) {
          return this._send(peer, "error", {
            code: decision?.code || "STREAM_REFUSED",
            message: decision?.message || "Incoming stream refused by policy",
            limitBytes: decision?.limitBytes,
            actualBytes: size,
            kind: p.kind
          }, { replyTo: msg.id });
        }
      }
  
      this.rxStreams.set(streamId, {
        peerId: peer.peerId,
        streamId,
        kind: p.kind,
        mime: p.mime,
        name: p.name,
        size: p.size,
        sha256: p.sha256,
        chunkBytes: p.chunkBytes,
        totalChunks: p.totalChunks,
        meta: p.meta || {},
        directives: p.directives || {},
        chunks: new Array(p.totalChunks),
        received: new Set(),
        closeReceived: false,
        closeReplyTo: null,
        finalizing: false
      });
  
      this.emit("stream:open", { peerId: peer.peerId, payload: p });
      this._send(peer, "ack", { streamId, accepted: true }, { replyTo: msg.id });
    }
  
    async _handleStreamChunk(peer, msg) {
      const p = msg.payload || {};
      const { streamId, seq, encoding } = p;
      const st = this.rxStreams.get(streamId);
      if (!st) return this._send(peer, "error", { code: "UNKNOWN_STREAM", message: "stream.chunk unknown streamId" }, { replyTo: msg.id });
  
      if (!Number.isInteger(seq) || seq < 0 || seq >= st.totalChunks) {
        return this._send(peer, "error", { code: "BAD_SEQ", message: "Invalid chunk seq" }, { replyTo: msg.id });
      }
  
      if (st.received.has(seq)) {
        // duplicate; ack anyway (batch ack below)
        this._sendStreamAck(peer, streamId, [seq]);
        return;
      }
  
      let u8;
      try {
        u8 = decodeChunkData(p, encoding);
      } catch (e) {
        return this._send(peer, "error", { code: "BAD_CHUNK", message: "Decode failed", details: String(e) }, { replyTo: msg.id });
      }
  
      st.chunks[seq] = u8;
      st.received.add(seq);
  
      this.emit("stream:chunk", { peerId: peer.peerId, streamId, seq, receivedCount: st.received.size });
  
      // ack the chunk (separate type so it doesn't interfere with RPC acks)
      this._sendStreamAck(peer, streamId, [seq]);
  
      if (st.closeReceived && st.received.size === st.totalChunks) {
        await this._finalizeAndAcknowledge(peer, st);
      }
    }
  
    async _handleStreamClose(peer, msg) {
      const p = msg.payload || {};
      const st = this.rxStreams.get(p.streamId);
      if (!st) return this._send(peer, "error", { code: "UNKNOWN_STREAM", message: "stream.close unknown streamId" }, { replyTo: msg.id });
  
      st.closeReceived = true;
      st.closeReplyTo = msg.id;
      if (p.sha256) st.sha256 = p.sha256;

      if (st.received.size === st.totalChunks) {
        await this._finalizeAndAcknowledge(peer, st);
      }
    }

    async _finalizeAndAcknowledge(peer, st) {
      if (st.finalizing) return;
      st.finalizing = true;
      try {
        const assembled = await this._finalizeStream(peer, st);
        this._send(peer, "ack", {
          streamId: st.streamId,
          closeReceived: true,
          delivered: true,
          verified: true,
          size: assembled.size,
          sha256: assembled.sha256
        }, { replyTo: st.closeReplyTo });
      } catch (error) {
        this.rxStreams.delete(st.streamId);
        this._send(peer, "error", {
          code: "STREAM_VERIFICATION_FAILED",
          message: String(error?.message || error),
          streamId: st.streamId
        }, { replyTo: st.closeReplyTo });
      }
    }
  
    async _finalizeStream(peer, st) {
      const total = st.chunks.reduce((acc, u8) => acc + (u8?.byteLength || 0), 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < st.totalChunks; i++) {
        const part = st.chunks[i];
        if (!part) throw new Error(`Missing chunk ${i}`);
        out.set(part, offset);
        offset += part.byteLength;
      }
  
      if (Number.isFinite(st.size) && st.size !== out.byteLength) {
        throw new Error(`Size mismatch: expected ${st.size}, got ${out.byteLength}`);
      }
  
      if (st.sha256) {
        const got = await sha256Hex(out);
        if (!timingSafeEqHex(got, st.sha256)) {
          throw new Error(`SHA-256 mismatch`);
        }
      }
  
      const assembled = {
        peerId: st.peerId,
        streamId: st.streamId,
        kind: st.kind,
        mime: st.mime,
        name: st.name,
        size: out.byteLength,
        sha256: st.sha256,
        meta: st.meta,
        directives: st.directives,
        data: out.buffer
      };
  
      this.rxStreams.delete(st.streamId);
  
      this.emit("stream:assembled", assembled);
      return assembled;
    }
  
    _sendStreamAck(peer, streamId, receivedSeqs) {
      // batch-friendly ack message for windowing
      this._send(peer, "stream.ack", { streamId, received: receivedSeqs });
    }
  
    /* ---------------- Internal: streams TX ---------------- */
  
    _handleStreamAck(peer, msg) {
      const p = msg.payload || {};
      const st = this.txStreams.get(p.streamId);
      if (!st) return;
  
      const received = p.received || [];
      for (const seq of received) {
        st.inFlight.delete(seq);
        st.acked.add(seq);
      }
  
      // pump continues in _sendChunksWithWindowing via emitted internal event
      this.emit("__internal_stream_ack__", { streamId: p.streamId, peerId: peer.peerId, received });
    }
  
    async _sendChunksWithWindowing(txState, { timeoutMs = 30000 } = {}) {
      const { peerId, streamId, bytes, chunkBytes, totalChunks } = txState;
  
      return new Promise((resolve, reject) => {
        let lastProgressAt = Date.now();
  
        const pump = () => {
          try {
            while (txState.inFlight.size < this.windowSize && txState.nextSeq < totalChunks) {
              const seq = txState.nextSeq++;
              const start = seq * chunkBytes;
              const end = Math.min(bytes.byteLength, start + chunkBytes);
              const slice = bytes.subarray(start, end);
  
              txState.inFlight.add(seq);
  
              const { payload, transferables } = encodeChunkPayload(streamId, seq, totalChunks, slice, txState.encoding);
              this._sendToPeer(peerId, "stream.chunk", payload, { transferables });
            }
  
            if (txState.acked.size === totalChunks) return done();
          } catch (e) {
            return fail(e);
          }
        };
  
        const done = () => {
          cleanup();
          resolve();
        };
  
        const fail = (e) => {
          cleanup();
          reject(e);
        };
  
        const cleanup = () => {
          clearInterval(watchdog);
          off();
        };
  
        const off = this.on("__internal_stream_ack__", (ack) => {
          if (ack.streamId !== streamId) return;
          lastProgressAt = Date.now();
          pump();
          if (txState.acked.size === totalChunks) done();
        });
  
        // watchdog: if no progress for timeoutMs -> fail
        const watchdog = setInterval(() => {
          if (Date.now() - lastProgressAt > timeoutMs) {
            fail(new Error(`Stream timeout: ${streamId}`));
          }
        }, Math.min(1000, Math.max(200, Math.floor(timeoutMs / 10))));
  
        pump();
      });
    }
  
    _chooseEncoding(preferBinary) {
      const pref = preferBinary || this.preferBinary;
      if (pref === "arraybuffer") return "arraybuffer";
      return "base64";
    }
  }
  
  /* ---------------- Helpers ---------------- */
  
  function summarizeEnvelope(env, peer) {
    const p = env.payload || {};
    const out = {
      type: env.type,
      id: env.id,
      replyTo: env.replyTo || undefined,
      sessionId: env.sessionId,
      from: env.from,
      peerId: env.peerId,
      ts: env.ts
    };
    if (env.type?.startsWith("stream.")) out.streamId = p.streamId;
    if (env.type === "stream.chunk") { out.seq = p.seq; out.bytes = p.bytes; out.encoding = p.encoding; }
    return out;
  }
  
  function clampInt(n, min, max) { n = Math.floor(n); return Math.max(min, Math.min(max, n)); }

  function streamPolicyError(code, message, details = {}) {
    return Object.assign(new Error(message), { code, payload: { code, message, ...details } });
  }
  
  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    const a = crypto.getRandomValues(new Uint8Array(16));
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    const hex = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  
  async function toUint8Array(data, { stringIsUtf8 = false } = {}) {
    if (data == null) return new Uint8Array();
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data === "string") {
      if (stringIsUtf8) return new TextEncoder().encode(data);
      return base64ToU8(data);
    }
    throw new Error("Unsupported data type");
  }
  
  function encodeChunkPayload(streamId, seq, totalChunks, u8slice, encoding) {
    const payload = { streamId, seq, totalChunks, bytes: u8slice.byteLength, encoding };
    if (encoding === "arraybuffer") {
      const ab = u8slice.buffer.slice(u8slice.byteOffset, u8slice.byteOffset + u8slice.byteLength);
      payload.data = ab;
      return { payload, transferables: [ab] };
    } else {
      payload.data = u8ToBase64(u8slice);
      return { payload, transferables: [] };
    }
  }
  
  function decodeChunkData(payload, encodingOverride) {
    const enc = encodingOverride || payload.encoding || "base64";
    if (enc === "arraybuffer") {
      const ab = payload.data;
      if (!(ab instanceof ArrayBuffer)) throw new Error("Expected ArrayBuffer");
      return new Uint8Array(ab);
    }
    if (typeof payload.data !== "string") throw new Error("Expected base64 string");
    return base64ToU8(payload.data);
  }
  
  async function sha256Hex(u8) {
    const buf = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  
  function timingSafeEqHex(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    return diff === 0;
  }
  
  /* base64 <-> Uint8Array */
  function u8ToBase64(u8) {
    const CHUNK = 0x8000;
    let binary = "";
    for (let i = 0; i < u8.length; i += CHUNK) {
      const sub = u8.subarray(i, i + CHUNK);
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  }
  
  function base64ToU8(b64) {
    const binary = atob(b64);
    const len = binary.length;
    const u8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
    return u8;
  }


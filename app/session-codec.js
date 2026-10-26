'use strict';

/*
 * Painting session file (.flus), format A of
 * docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md §2.4.
 *
 *   "FLUS" | u8 formatVersion | u8 flags | gzip(body)
 *   body:   u32 header length + header JSON
 *           [flags.0] u32 PNG length + baseline PNG
 *           records: tag u8 + payload ... END
 *
 * Ticks are lossless float32 (fluid-session phase 2: no quantum keeps a replay
 * within AC-REC-5, the dynamics are chaotic below one float32 ulp). Each
 * component is predicted from the two before it, p = fround(2*p1 - p2), and
 * the residual is the distance between the two floats in ulps, zigzag-varint
 * encoded. Contacts are rare and stored as float64, exactly as recorded.
 *
 * A session is { header, baselinePng, records }, the same shape in and out:
 *   { type: 'begin', params, variation }
 *   { type: 'ticks', data: Float32Array(3n) }   x, y, height per tick
 *   { type: 'contact', x, y, pressure }
 *   { type: 'end' }
 *   { type: 'idle', count }
 *   { type: 'command', command }               { op: 'undo' } ...
 * The tick scale is not stored: the engine always ticks with the stroke's
 * brushSize, which the 'begin' params carry.
 */
const SessionCodec = (() => {
  const MAGIC = [0x46, 0x4C, 0x55, 0x53]; // "FLUS"
  const FORMAT_VERSION = 1;
  const FLAG_BASELINE = 1;
  const FLAG_KEYFRAMES = 2;
  const TICK_ENCODING = 'float32-pred2';
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const TAG = Object.freeze({
    STROKE_BEGIN: 0x01, TICKS: 0x02, STROKE_END: 0x03, CONTACT: 0x04,
    IDLE: 0x05, COMMAND: 0x06, KEYFRAMES: 0x10, END: 0xFF,
  });

  const scratch = new DataView(new ArrayBuffer(8));
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8', { fatal: true });

  function formatError(message) {
    const error = new Error(`Session file: ${message}`);
    error.name = 'SessionFormatError';
    return error;
  }

  /* A float32 as an integer that orders like the float, so neighbouring
   * floats are neighbouring integers. -0 and +0 stay distinct (-1 and 0). */
  function floatKey(value) {
    scratch.setFloat32(0, value);
    const bits = scratch.getUint32(0);
    return bits < 0x80000000 ? bits : -1 - (bits - 0x80000000);
  }

  function keyFloat(key) {
    scratch.setUint32(0, key >= 0 ? key : 0x80000000 + (-1 - key));
    return scratch.getFloat32(0);
  }

  class ByteWriter {
    constructor(capacity = 4096) {
      this.bytes = new Uint8Array(capacity);
      this.length = 0;
    }

    _reserve(count) {
      if (this.length + count <= this.bytes.length) return;
      let capacity = this.bytes.length * 2;
      while (capacity < this.length + count) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }

    u8(value) {
      this._reserve(1);
      this.bytes[this.length++] = value;
    }

    u32(value) {
      this._reserve(4);
      new DataView(this.bytes.buffer).setUint32(this.length, value, true);
      this.length += 4;
    }

    f64(value) {
      this._reserve(8);
      new DataView(this.bytes.buffer).setFloat64(this.length, value, true);
      this.length += 8;
    }

    // Unsigned LEB128 by arithmetic, not bit operators: values reach 2^33.
    varint(value) {
      this._reserve(10);
      while (value >= 0x80) {
        this.bytes[this.length++] = (value % 0x80) | 0x80;
        value = Math.floor(value / 0x80);
      }
      this.bytes[this.length++] = value;
    }

    zigzag(value) {
      this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
    }

    raw(bytes) {
      this._reserve(bytes.length);
      this.bytes.set(bytes, this.length);
      this.length += bytes.length;
    }

    json(value, prefix) {
      const bytes = textEncoder.encode(JSON.stringify(value));
      if (prefix === 'u32') this.u32(bytes.length);
      else this.varint(bytes.length);
      this.raw(bytes);
    }

    result() {
      return this.bytes.slice(0, this.length);
    }
  }

  class ByteReader {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.offset = 0;
    }

    _need(count) {
      if (this.offset + count > this.bytes.length) throw formatError('unexpected end of data.');
    }

    u8() {
      this._need(1);
      return this.bytes[this.offset++];
    }

    u32() {
      this._need(4);
      const value = this.view.getUint32(this.offset, true);
      this.offset += 4;
      return value;
    }

    f64() {
      this._need(8);
      const value = this.view.getFloat64(this.offset, true);
      this.offset += 8;
      return value;
    }

    varint() {
      let value = 0;
      let factor = 1;
      for (let i = 0; i < 10; i++) {
        const byte = this.u8();
        value += (byte & 0x7F) * factor;
        if (byte < 0x80) return value;
        factor *= 0x80;
      }
      throw formatError('varint is too long.');
    }

    zigzag() {
      const value = this.varint();
      return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
    }

    raw(count) {
      this._need(count);
      const bytes = this.bytes.subarray(this.offset, this.offset + count);
      this.offset += count;
      return bytes;
    }

    json(prefix) {
      const length = prefix === 'u32' ? this.u32() : this.varint();
      try {
        return JSON.parse(textDecoder.decode(this.raw(length)));
      } catch (error) {
        if (error.name === 'SessionFormatError') throw error;
        throw formatError('a JSON record is malformed.');
      }
    }
  }

  function encodeTicks(writer, data, state) {
    const count = data.length / 3;
    writer.varint(count);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const value = Math.fround(data[i * 3 + c]);
        writer.zigzag(floatKey(value) - floatKey(state.predict(c)));
        state.next[c] = value;
      }
      state.advance();
    }
  }

  function decodeTicks(reader, state) {
    const count = reader.varint();
    if (count > 1e7) throw formatError('tick block is implausibly large.');
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        const value = keyFloat(floatKey(state.predict(c)) + reader.zigzag());
        data[i * 3 + c] = value;
        state.next[c] = value;
      }
      state.advance();
    }
    return data;
  }

  /* Second-order prediction over one stroke's float32 ticks, shared by encoder
   * and decoder so the two cannot drift. The first tick is predicted from the
   * stroke's begin point (height from zero), the second from the first. */
  function strokeState(params) {
    const start = [Math.fround(params.x), Math.fround(params.y), 0];
    let previous = [0, 0, 0];   // tick i-2
    let last = [0, 0, 0];       // tick i-1
    let seen = 0;
    return {
      next: [0, 0, 0],
      predict(c) {
        if (seen === 0) return start[c];
        if (seen === 1) return last[c];
        return Math.fround(2 * last[c] - previous[c]);
      },
      advance() {
        const recycled = previous;
        previous = last;
        last = this.next;
        this.next = recycled;
        seen++;
      },
    };
  }

  function validateRecord(record) {
    switch (record && record.type) {
      case 'begin':
        if (!record.params || !Number.isFinite(record.params.x) || !Number.isFinite(record.params.y)) {
          throw formatError('a stroke begin has no start point.');
        }
        return;
      case 'ticks':
        if (!(record.data instanceof Float32Array) || record.data.length % 3 !== 0) {
          throw formatError('ticks must be a Float32Array of x, y, height triples.');
        }
        return;
      case 'contact':
      case 'end':
      case 'idle':
      case 'command':
        return;
      default:
        throw formatError(`unknown record type ${record && record.type}.`);
    }
  }

  /** The uncompressed body. Synchronous; used by encode() and by size tests. */
  function encodeBody({ header, baselinePng = null, records }) {
    const writer = new ByteWriter(64 * 1024);
    writer.json({ ...header, tickEncoding: TICK_ENCODING }, 'u32');
    if (baselinePng) {
      writer.u32(baselinePng.length);
      writer.raw(baselinePng);
    }
    let state = null;
    for (const record of records) {
      validateRecord(record);
      switch (record.type) {
        case 'begin':
          writer.u8(TAG.STROKE_BEGIN);
          writer.json({ ...record.params, variation: record.variation });
          state = strokeState(record.params);
          break;
        case 'ticks':
          if (!state) throw formatError('ticks outside a stroke.');
          writer.u8(TAG.TICKS);
          encodeTicks(writer, record.data, state);
          break;
        case 'contact':
          writer.u8(TAG.CONTACT);
          writer.f64(record.x);
          writer.f64(record.y);
          writer.f64(record.pressure);
          break;
        case 'end':
          writer.u8(TAG.STROKE_END);
          state = null;
          break;
        case 'idle':
          writer.u8(TAG.IDLE);
          writer.varint(record.count);
          break;
        case 'command':
          writer.u8(TAG.COMMAND);
          writer.json(record.command);
          break;
      }
    }
    writer.u8(TAG.END);
    return writer.result();
  }

  function decodeBody(bytes, { baseline = false } = {}) {
    const reader = new ByteReader(bytes);
    const header = reader.json('u32');
    if (!header || typeof header !== 'object') throw formatError('the header is not an object.');
    if (header.tickEncoding !== TICK_ENCODING) {
      throw formatError(`unsupported tick encoding ${header.tickEncoding}.`);
    }
    const baselinePng = baseline ? reader.raw(reader.u32()).slice() : null;
    const records = [];
    let state = null;
    for (;;) {
      const tag = reader.u8();
      if (tag === TAG.END) break;
      switch (tag) {
        case TAG.STROKE_BEGIN: {
          const params = reader.json();
          const { variation, ...rest } = params;
          records.push({ type: 'begin', params: rest, variation });
          state = strokeState(rest);
          break;
        }
        case TAG.TICKS:
          if (!state) throw formatError('ticks outside a stroke.');
          records.push({ type: 'ticks', data: decodeTicks(reader, state) });
          break;
        case TAG.CONTACT:
          records.push({ type: 'contact', x: reader.f64(), y: reader.f64(), pressure: reader.f64() });
          break;
        case TAG.STROKE_END:
          records.push({ type: 'end' });
          state = null;
          break;
        case TAG.IDLE:
          records.push({ type: 'idle', count: reader.varint() });
          break;
        case TAG.COMMAND:
          records.push({ type: 'command', command: reader.json() });
          break;
        case TAG.KEYFRAMES:
          // Section C (phase 5). Skipped by length until something reads it.
          reader.raw(reader.varint());
          break;
        default:
          throw formatError(`unknown record tag 0x${tag.toString(16)}.`);
      }
    }
    return { header, baselinePng, records };
  }

  async function pipe(bytes, stream) {
    const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The complete .flus file. */
  async function encode(session) {
    const body = encodeBody(session);
    const compressed = await pipe(body, new CompressionStream('gzip'));
    const file = new Uint8Array(6 + compressed.length);
    file.set(MAGIC, 0);
    file[4] = FORMAT_VERSION;
    file[5] = session.baselinePng ? FLAG_BASELINE : 0;
    file.set(compressed, 6);
    return file;
  }

  async function decode(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length > MAX_FILE_BYTES) throw formatError('the file is larger than 25 MB.');
    if (bytes.length < 6 || MAGIC.some((byte, i) => bytes[i] !== byte)) {
      throw formatError('this is not a Fluid Paint session (.flus) file.');
    }
    if (bytes[4] !== FORMAT_VERSION) throw formatError(`format version ${bytes[4]} is not supported.`);
    const flags = bytes[5];
    let body;
    try {
      body = await pipe(bytes.subarray(6), new DecompressionStream('gzip'));
    } catch (_) {
      throw formatError('the compressed body is damaged.');
    }
    const session = decodeBody(body, { baseline: (flags & FLAG_BASELINE) !== 0 });
    session.flags = flags;
    session.hasKeyframes = (flags & FLAG_KEYFRAMES) !== 0;
    return session;
  }

  return Object.freeze({
    FORMAT_VERSION, TICK_ENCODING, MAX_FILE_BYTES, TAG,
    encodeBody, decodeBody, encode, decode,
    floatKey, keyFloat,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SessionCodec;
if (typeof globalThis !== 'undefined') globalThis.SessionCodec = SessionCodec;

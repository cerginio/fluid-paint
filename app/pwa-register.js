/* Production-only pinned readiness and explicitly consented, work-safe updates. */
(function (root) {
  'use strict';
  function readiness({controller, active, status, shellId}) {
    if (!controller) return 'preparing';
    return controller === active && active.state === 'activated' && status && status.complete === true &&
      /^[a-f0-9]{64}$/.test(status.releaseId || '') && status.shellId === shellId && /^[a-f0-9]{64}$/.test(shellId || '') ? 'ready' : 'unavailable';
  }
  function requestStatus(worker, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const requestId = root.crypto.randomUUID(), channel = new root.MessageChannel();
      const finish = () => { clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
      const timer = setTimeout(() => { finish(); reject(new Error('STATUS timeout')); }, timeout);
      channel.port1.onmessage = event => { if (event.data?.requestId !== requestId) return; finish(); resolve(event.data); };
      try { worker.postMessage({type:'STATUS', requestId, documentShellId:root.document?.querySelector('meta[name="fluid-shell-id"]')?.content}, [channel.port2]); } catch (error) { finish(); reject(error); }
    });
  }
  // Dependencies are injectable so guards exercise the real scheduler/lifecycle code.
  function createDetection({registration, container, visible, now = Date.now,
    schedule = setTimeout, cancel = clearTimeout, status = requestStatus, online = () => root.navigator?.onLine !== false, render = () => {}}) {
    const state = {phase:'idle', active:null, waiting:null, lastCheck:null, result:'Not checked yet', later:false};
    const watched = new Set(), disposers = [];
    let timer = null, flight = null, lastAttempt = -Infinity, deadline = Infinity, epoch = 0, disposed = false;
    const emit = () => { if (!disposed) render({...state}); };
    function arm() {
      if (timer !== null) cancel(timer);
      timer = null;
      if (!disposed && visible() && Number.isFinite(deadline)) timer = schedule(() => { timer = null; check('timer'); }, Math.max(0, deadline - now()));
    }
    function listen(target, type, fn) { target.addEventListener(type, fn); disposers.push(() => target.removeEventListener(type, fn)); }
    async function inspect() {
      const own = ++epoch, active = registration.active, waiting = registration.waiting;
      watch(registration.installing); watch(waiting); watch(active);
      const read = async worker => {
        if (!worker) return null;
        const reply = await status(worker);
        if (!reply.complete || !/^[a-f0-9]{64}$/.test(reply.releaseId || '')) throw Error('Unverified worker');
        return reply;
      };
      const replies = await Promise.allSettled([read(active), read(waiting)]);
      if (disposed || own !== epoch || active !== registration.active || waiting !== registration.waiting) return;
      state.active = replies[0].status === 'fulfilled' ? replies[0].value?.releaseId : null;
      state.activeBuildTime = replies[0].status === 'fulfilled' ? replies[0].value?.buildTime : null;
      const identity = replies[1].status === 'fulfilled' && waiting?.state === 'installed' ? replies[1].value?.releaseId : null;
      if (identity !== state.waiting) state.later = false;
      state.waiting = identity;
      // A late local STATUS response must not erase a failed network check.
      if (identity) { if (state.phase !== 'failed') state.phase = 'ready'; }
      else if (registration.installing) state.phase = 'downloading';
      else if (waiting || replies.some(r => r.status === 'rejected')) {
        state.phase = 'failed'; state.result = 'Worker version unverified';
      } else if (state.phase === 'downloading' || state.phase === 'ready') state.phase = 'idle';
      emit();
    }
    function refresh() { return inspect().catch(() => { state.phase='failed'; emit(); }); }
    function watch(worker) {
      if (!worker || watched.has(worker)) return;
      watched.add(worker);
      listen(worker, 'statechange', () => {
        if (worker.state === 'redundant') {
          // An old replaced worker becoming redundant is not an install failure.
          if (worker !== registration.active && worker !== container.controller && !registration.waiting) {
            state.phase='failed'; state.result='Update download failed; current version still works'; emit();
          }
        }
        refresh();
      });
    }
    function check(reason = 'manual') {
      if (disposed) return Promise.resolve();
      if (flight) return flight;
      if (reason !== 'manual' && (!visible() || now() - lastAttempt < 60000)) { arm(); return Promise.resolve(); }
      lastAttempt = now(); deadline = lastAttempt + 900000; state.lastCheck = lastAttempt;
      state.phase = 'checking'; state.result = 'Checking updates'; emit(); arm();
      flight = Promise.resolve().then(async () => {
        await registration.update();
        // Some browsers resolve update() from an existing candidate even offline.
        // Still attempt it, but never turn an offline signal into a no-update claim.
        if (!online()) throw new Error('Network check not confirmed while offline');
      }).then(async () => {
        if (state.phase !== 'failed') state.result = 'Check complete';
        if (state.phase === 'checking') state.phase = 'idle';
        await refresh();
        if (state.phase === 'idle') state.result = 'No update found';
        emit();
      }, async () => {
        await refresh();
        state.phase = 'failed'; state.result = 'Check failed (possibly offline). Updates may still exist'; emit();
      }).finally(() => { flight = null; deadline = now() + 900000; arm(); });
      return flight;
    }
    listen(registration, 'updatefound', () => { watch(registration.installing); state.phase='downloading'; emit(); refresh(); });
    listen(container, 'controllerchange', () => { refresh(); });
    refresh();
    return {check, refresh, visibility() { if (visible()) { check('foreground'); } else { if(timer !== null) cancel(timer); timer=null; } },
      later() { state.later=true; emit(); },
      dispose() { disposed=true; ++epoch; if(timer !== null) cancel(timer); disposers.forEach(fn=>fn()); },
      snapshot() { return {...state}; }};
  }
  const updateMarker = 'fluid-pwa-update-once-v1';
  function createActivation({registration, container, storage, safety, loadedRelease, loadedShell, status = requestStatus,
    save, hasArtwork, send, reload, lock = () => {}, notify = () => {}, render = () => {}}) {
    let phase='idle', target=null, flight=false, exported=false;
    const emit=(message='')=>render({phase,target,exported,message});
    const blocked=()=>{try{return safety()?.active !== false;}catch{return true;}};
    const fail=message=>{phase='error';lock(false);emit(message);return false;};
    function changed() {
      if(phase!=='applying'||!target)return;
      const current=container.controller;
      status(current).then(reply=>{
        if(phase!=='applying'||current!==container.controller||!reply.complete||reply.releaseId!==target)return;
        const marker=JSON.parse(storage.getItem(updateMarker)||'null');
        if(marker?.target!==target||marker.reloaded)return;
        storage.setItem(updateMarker,JSON.stringify({target,reloaded:true}));phase='reloading';emit();reload();
      }).catch(()=>fail('Update could not be verified.'));
    }
    container.addEventListener('controllerchange',changed);
    return {
      async verifyLoaded(){try{const m=JSON.parse(storage.getItem(updateMarker)||'null');if(!m?.reloaded)return;
        storage.removeItem(updateMarker);const actual=loadedRelease||await status(container.controller).then(r=>r.complete&&r.shellId===loadedShell?r.releaseId:null);
        if(m.target!==actual)return fail('Unexpected version loaded.');phase='verified';emit();
      }catch{fail('Session storage unavailable.');}},
      async begin(){
        if(flight||['applying','reloading'].includes(phase))return false;
        if(blocked())return fail('Finish the current operation, then retry.');
        const worker=registration.waiting;if(!worker)return fail('No update ready.');
        flight=true;exported=false;
        try{
          const reply=await status(worker);
          if(blocked()||worker!==registration.waiting||!reply.complete||!/^[a-f0-9]{64}$/.test(reply.releaseId))throw Error('candidate');
          target=reply.releaseId;phase='saving';lock(true);emit();
          // UI/input stays locked throughout the asynchronous export and identity recheck.
          // Unknown dirty state is not a clean canvas: inspect actual pigment/background.
          if(await hasArtwork()) {await save();exported=true;}
          const check=await status(worker);
          if(blocked()||registration.waiting!==worker||!check.complete||check.releaseId!==target)throw Error('candidate');
          storage.setItem(updateMarker,JSON.stringify({target,reloaded:false}));
          phase='applying';emit();notify(target);await send(worker,{type:'ALLOW_UPDATE',releaseId:target});return true;
        }catch{try{storage.removeItem(updateMarker);}catch{}return fail('PNG save or update verification failed. Update not applied.');}
        finally{flight=false;}
      },
      cancel(){},snapshot(){return {phase,target,exported};},dispose(){container.removeEventListener('controllerchange',changed);}
    };
  }
  function requestCommand(worker, data) {
    return new Promise((resolve,reject) => {
      const requestId=root.crypto.randomUUID(), c=new root.MessageChannel();
      const done=()=>{clearTimeout(timer);c.port1.close();c.port2.close();};
      const timer=setTimeout(()=>{done();reject(Error('Update timeout'));},2000);
      c.port1.onmessage=e=>{if(e.data?.requestId!==requestId)return;done();e.data.allowed?resolve(e.data):reject(Error('Update refused'));};
      try { worker.postMessage({...data,requestId},[c.port2]); } catch(e) {done();reject(e);}
    });
  }
  function installMode(nav, standalone, prompt) {
    if (standalone) return 'standalone';
    if (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios';
    return prompt ? 'prompt' : 'fallback';
  }
  if (typeof module !== 'undefined') module.exports = {readiness, requestStatus, installMode, createDetection, createActivation, updateMarker};
  if (!root.document) return;
  const doc = root.document;
  function start() {
    // Embedded host owns its UI; no additional overlay or install solicitation.
    if (root !== root.top || new URLSearchParams(root.location.search).get('embedded') === '1') return;
    const panel = doc.createElement('details'); panel.id = 'pwa-panel';
    const svg = root.FluidPwaIcon;
    const icon = (id, shape, name, hidden = false) => `<button type="button" id="${id}" title="${name}" aria-label="${name}"${hidden ? ' hidden' : ''}>${svg(shape)}</button>`;
    panel.innerHTML = `<summary title="Offline and updates" aria-label="Offline and updates"><span id="pwa-state-icon" aria-hidden="true">${svg('cloud')}</span></summary>
      <div class="pwa-content">
        <p id="pwa-status" role="status" aria-live="polite"></p><p id="pwa-update" role="status" aria-live="polite"></p>
        <div class="pwa-actions" role="group" aria-label="Offline and update actions">
          ${icon('pwa-verify','circle-check','Verify offline readiness')}${icon('pwa-check','refresh-cw-alt-3','Check for updates')}${icon('pwa-later','clock','Later',true)}${icon('pwa-apply','arrow-up','Update',true)}${icon('pwa-install','download','Install app',true)}
          <button type="button" id="pwa-save" hidden>Save PNG</button>
          <progress id="pwa-progress" aria-label="Checking or downloading" hidden></progress>
        </div>
        <p id="pwa-activation-status" role="status" aria-live="polite"></p>
        <p id="pwa-versions"></p><p id="pwa-last-check"></p>
      </div>`;
    doc.body.appendChild(panel);
    doc.addEventListener('pointerdown', event => {
      if (panel.open && !panel.contains(event.target)) panel.open = false;
    });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        panel.open = false; panel.querySelector('summary').focus();
      }
    });
    const statusNode = doc.getElementById('pwa-status');
    const shellId = doc.querySelector('meta[name="fluid-shell-id"]')?.content;
    const buildTime = doc.querySelector('meta[name="fluid-build-time"]')?.content;
    const versionTime = value => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value || '') ? value.slice(0,16).replace('T',' ') : 'unverified';
    let detection, activation, lastActiveIdentity;
    let registration, epoch = 0, wasReady = false, deferredPrompt = null;
    function refreshSaveButton() {
      const button = doc.getElementById('pwa-save');
      button.hidden = true;
      if (!panel.open || doc.hidden || !detection?.snapshot().waiting ||
          registration?.waiting?.state !== 'installed' ||
          ['saving','applying','reloading'].includes(activation?.snapshot().phase)) return;
      try {
        if (root.__painter?.getUpdateSafety().active === false) button.hidden = !root.__painter.hasArtwork();
      } catch { /* A failed readback does not establish that artwork can be saved. */ }
    }
    panel.addEventListener('toggle', refreshSaveButton);
    // Also catches asynchronous imports, playback completion, clearing and Undo.
    // GPU readback only runs for an open, visible panel with an installed update.
    root.setInterval(refreshSaveButton, 1000);
    function show(state, text) {
      panel.dataset.state = state;
      doc.getElementById('pwa-state-icon').innerHTML = svg(state === 'ready' ? 'circle-check' : state === 'unavailable' || root.navigator.onLine === false ? 'cloud-slash' : 'cloud');
      statusNode.textContent = '';
      // Readiness detail is represented by the icon, not working-UI prose.
    }
    async function verify() {
      const ownEpoch = ++epoch, controller = root.navigator.serviceWorker?.controller;
      show(controller ? 'preparing' : 'unavailable', 'Verifying local files. Registration alone is not readiness.');
      try {
        registration = await root.navigator.serviceWorker.getRegistration('/');
        if (ownEpoch !== epoch) return;
        if (!controller) { show('preparing', 'This page is not controlled yet. Save your work before a manual reload after preparation.'); return; }
        const status = await requestStatus(controller);
        if (ownEpoch !== epoch || controller !== root.navigator.serviceWorker.controller) return;
        const state = readiness({controller, active:registration?.active, status, shellId});
        show(state, state === 'ready' ? 'Local shell verified. This is not an artwork backup.' : wasReady || status.complete === false ? 'Local preparation missing or lost. Prepare again online; the cause of removal is unknown.' : 'Page and worker versions unverified. Offline launch is not guaranteed.');
        wasReady = state === 'ready' || wasReady;
      } catch (error) { if (ownEpoch === epoch) show('unavailable', 'Offline readiness unverified. Retry online; a connection or registration is not proof.'); }
    }
    function installUI() {
      const mode = installMode(root.navigator, root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone, deferredPrompt);
      const button = doc.getElementById('pwa-install'); button.hidden = mode !== 'prompt';
    }
    root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; installUI(); });
    root.addEventListener('appinstalled', () => { deferredPrompt = null; installUI(); });
    doc.getElementById('pwa-install').onclick = async () => {
      const prompt = deferredPrompt; deferredPrompt = null; installUI();
      if (!prompt) return;
      try { await prompt.prompt(); await prompt.userChoice; } catch { /* unsupported/cancel remains usable */ }
    };
    installUI();
    if (!root.isSecureContext || !('serviceWorker' in root.navigator)) { show('unavailable', 'Offline worker unsupported here. Keep working online.'); return; }
    doc.getElementById('pwa-verify').onclick = verify;
    root.navigator.serviceWorker.addEventListener('controllerchange', verify);
    doc.addEventListener('visibilitychange', () => { detection?.visibility(); if (!doc.hidden) verify(); });
    root.addEventListener('online', () => { verify(); detection?.check('online'); });
    verify();
    root.navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'}).then(r => {
      registration = r;
      activation = createActivation({registration:r, container:root.navigator.serviceWorker, storage:root.sessionStorage,
        loadedShell:shellId, safety:() => root.__painter?.getUpdateSafety(), send:requestCommand,
        hasArtwork:() => root.__painter.hasArtwork(), save:() => root.__painter.save(),
        reload:() => root.location.reload(),
        lock:value => { doc.body.inert=value; },
        render:state => { panel.dataset.activation=state.phase;
          refreshSaveButton();
          doc.getElementById('pwa-activation-status').textContent=state.message;
          if(state.phase==='error')panel.open=true;
        }});
      activation.verifyLoaded();
      doc.getElementById('pwa-apply').onclick=()=>activation.begin();
      doc.getElementById('pwa-save').onclick=async()=>{try{await root.__painter.save();doc.getElementById('pwa-activation-status').textContent='';}
        catch{doc.getElementById('pwa-activation-status').textContent='PNG save failed.';}};
      detection = createDetection({registration:r, container:root.navigator.serviceWorker, visible:() => !doc.hidden, render:state => {
        panel.dataset.update = state.phase;
        doc.getElementById('pwa-update').textContent = {idle:'', checking:'Checking updates', downloading:'Downloading update', ready:state.later ? 'Update postponed' : 'Update ready', failed:'Update check failed'}[state.phase];
        doc.getElementById('pwa-progress').hidden = !['checking','downloading'].includes(state.phase);
        doc.getElementById('pwa-versions').textContent = `Active version: ${versionTime(state.activeBuildTime || (state.active ? buildTime : null))}`;
        doc.getElementById('pwa-last-check').textContent = `Last check: ${state.lastCheck === null ? 'not yet' : new Date(state.lastCheck).toLocaleTimeString('en')}. ${state.result}`;
        doc.getElementById('pwa-apply').hidden = !state.waiting;
        doc.getElementById('pwa-later').hidden = !state.waiting || state.later;
        refreshSaveButton();
        if (state.active && state.active !== lastActiveIdentity) { lastActiveIdentity = state.active; verify(); }
      }});
      doc.getElementById('pwa-check').onclick = () => detection.check('manual');
      doc.getElementById('pwa-later').onclick = () => detection.later();
      detection.check('startup');
      verify();
    }).catch(() => show('unavailable', 'Online preparation failed. First offline launch is not guaranteed.'));
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once:true}); else start();
}(typeof window !== 'undefined' ? window : globalThis));

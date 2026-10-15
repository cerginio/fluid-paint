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
      try { worker.postMessage({type:'STATUS', requestId}, [channel.port2]); } catch (error) { finish(); reject(error); }
    });
  }
  // Dependencies are injectable so guards exercise the real scheduler/lifecycle code.
  function createDetection({registration, container, visible, now = Date.now,
    schedule = setTimeout, cancel = clearTimeout, status = requestStatus, online = () => root.navigator?.onLine !== false, render = () => {}}) {
    const state = {phase:'idle', active:null, waiting:null, lastCheck:null, result:'Ще не перевірено', later:false};
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
        return reply.releaseId;
      };
      const replies = await Promise.allSettled([read(active), read(waiting)]);
      if (disposed || own !== epoch || active !== registration.active || waiting !== registration.waiting) return;
      state.active = replies[0].status === 'fulfilled' ? replies[0].value : null;
      const identity = replies[1].status === 'fulfilled' && waiting?.state === 'installed' ? replies[1].value : null;
      if (identity !== state.waiting) state.later = false;
      state.waiting = identity;
      // A late local STATUS response must not erase a failed network check.
      if (identity) { if (state.phase !== 'failed') state.phase = 'ready'; }
      else if (registration.installing) state.phase = 'downloading';
      else if (waiting || replies.some(r => r.status === 'rejected')) {
        state.phase = 'failed'; state.result = 'Не вдалося підтвердити версію worker';
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
            state.phase='failed'; state.result='Завантаження оновлення не завершилось; поточна версія працює'; emit();
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
      state.phase = 'checking'; state.result = 'Перевіряємо оновлення'; emit(); arm();
      flight = Promise.resolve().then(async () => {
        await registration.update();
        // Some browsers resolve update() from an existing candidate even offline.
        // Still attempt it, but never turn an offline signal into a no-update claim.
        if (!online()) throw new Error('Network check not confirmed while offline');
      }).then(async () => {
        if (state.phase !== 'failed') state.result = 'Перевірку завершено';
        if (state.phase === 'checking') state.phase = 'idle';
        await refresh();
        if (state.phase === 'idle') state.result = 'Нової версії не виявлено';
        emit();
      }, async () => {
        await refresh();
        state.phase = 'failed'; state.result = 'Перевірка не вдалася (можливо, немає мережі). Це не означає, що оновлень немає'; emit();
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
    send, reload, lock = () => {}, notify = () => {}, render = () => {}}) {
    let phase = 'idle', target = null, worker = null, flight = false, exported = false;
    const emit = (message = '') => render({phase, target, exported, message});
    function blocked() {
      try { return safety()?.active !== false; } catch { return true; }
    }
    function fail(message) { phase = 'error'; exported = false; lock(false); emit(message); return false; }
    function changed() {
      if (phase !== 'applying' || !target) return;
      const current = container.controller;
      if (!current) return;
      status(current).then(reply => {
        if (phase !== 'applying' || current !== container.controller || reply.releaseId !== target || !reply.complete) return;
        try {
          const marker = JSON.parse(storage.getItem(updateMarker));
          if (marker?.target !== target || marker.reloaded) return;
          // Consume BEFORE reload; a crash or duplicate event cannot loop.
          storage.setItem(updateMarker, JSON.stringify({target, reloaded:true}));
          phase = 'reloading'; emit(); reload();
        } catch { fail('Не вдалося записати одноразове підтвердження. Перезавантажте вручну.'); }
      }).catch(() => fail('Не вдалося підтвердити новий worker. Перезавантажте вручну.'));
    }
    container.addEventListener('controllerchange', changed);
    async function verifyLoaded() {
      try {
        const marker = JSON.parse(storage.getItem(updateMarker) || 'null');
        if (!marker?.reloaded) return;
        storage.removeItem(updateMarker);
        const actual = loadedRelease || await status(container.controller).then(r => r.complete && r.shellId === loadedShell ? r.releaseId : null);
        if (marker.target !== actual) return fail('Завантажено неочікувану версію. Повторного reload не буде.');
        phase = 'verified'; emit('Нову версію завантажено й перевірено.');
      } catch { fail('Session storage недоступне. Автоматичний reload вимкнено.'); }
    }
    return {
      verifyLoaded,
      async begin() {
        if (flight || ['applying','reloading'].includes(phase)) return false;
        exported = false;
        if (blocked()) return fail('Завершіть мазок, import/export/Bake та playback (також paused) у цій вкладці й повторіть.');
        worker = registration.waiting;
        if (!worker) return fail('Немає готового оновлення.');
        try {
          const reply = await status(worker);
          if (worker !== registration.waiting || !reply.complete || !/^[a-f0-9]{64}$/.test(reply.releaseId)) throw Error();
          target = reply.releaseId; phase = 'confirm'; emit('Малюнок потенційно незбережений. PNG — лише пласке зображення; мокра фарба та Undo будуть втрачені.');
          notify(target); return true;
        } catch { return fail('Версію оновлення не підтверджено.'); }
      },
      cancel() { if (flight || ['applying','reloading'].includes(phase)) return; phase='idle'; target=null; exported=false; emit('Оновлення відкладено.'); },
      async export(save) {
        if (phase !== 'confirm' || flight || blocked()) return false;
        flight=true; phase='exporting'; emit('Експортуємо PNG. Завершення API не доводить збереження файлу.');
        try { await save(); exported=true; phase='confirm'; emit('Перевірте файл PNG на диску, потім окремо підтвердьте оновлення.'); return true; }
        catch { return fail('PNG export не вдався. Оновлення не застосовано.'); }
        finally { flight=false; }
      },
      async allow(choice) {
        if (phase !== 'confirm' || flight || !['discard','saved'].includes(choice) || (choice==='saved' && !exported)) return false;
        if (blocked()) return fail('Ця вкладка ще працює. Завершіть операцію й повторіть.');
        flight=true;
        try {
          const reply = await status(worker);
          if (blocked() || registration.waiting !== worker || !reply.complete || reply.releaseId !== target) throw Error('stale');
          storage.setItem(updateMarker, JSON.stringify({target,reloaded:false}));
          phase='applying'; lock(true); emit('Застосовуємо оновлення лише у цій вкладці…');
          await send(worker, {type:'ALLOW_UPDATE',releaseId:target});
          return true;
        } catch { lock(false); try { storage.removeItem(updateMarker); } catch {} return fail('Оновлення не підтверджено. Роботу не перервано; повторіть.'); }
        finally { flight=false; }
      },
      snapshot() { return {phase,target,exported}; },
      dispose() { container.removeEventListener('controllerchange', changed); }
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
    panel.innerHTML = '<summary>Offline / встановлення<span class="pwa-summary-warning">Перезапуск не відновлює малюнок, мокру фарбу й Undo. Спершу збережіть PNG.</span></summary><div class="pwa-content"><p id="pwa-status" role="status" aria-live="polite"></p><p id="pwa-reason"></p><p id="pwa-warning"><strong>Перед перезавантаженням або оновленням збережіть PNG.</strong> Offline-перезапуск не відновлює малюнок, мокру фарбу та історію Undo. PNG зберігає лише пласке зображення.</p><p>Перший запуск без мережі потребує попередньої online-підготовки. Браузер може видалити локальні дані; після очищення потрібна повторна підготовка online.</p><button type="button" id="pwa-verify">Перевірити offline-готовність</button><section aria-label="Оновлення"><p id="pwa-update" role="status" aria-live="polite"></p><progress id="pwa-progress" aria-label="Перевірка або завантаження" hidden></progress><p id="pwa-versions"></p><p id="pwa-last-check"></p><button type="button" id="pwa-check">Перевірити оновлення</button><button type="button" id="pwa-later" hidden>Пізніше</button><button type="button" id="pwa-apply" hidden>Оновити</button><div id="pwa-consent" hidden><p id="pwa-activation-status" role="status"></p><p id="pwa-clients">Інші вкладки — лише повідомлення, не блокування.</p><button type="button" id="pwa-export">Завантажити PNG</button><button type="button" id="pwa-saved" hidden>PNG збережено — оновити все одно</button><button type="button" id="pwa-discard">Оновити без збереження — оновити все одно</button><button type="button" id="pwa-cancel">Пізніше</button></div><p id="pwa-update-note">Оновлення не застосовуються автоматично. Лише ця вкладка перезавантажиться після окремої згоди.</p></section><p id="pwa-install-info"></p><button type="button" id="pwa-install" hidden>Встановити застосунок</button></div>';
    doc.body.appendChild(panel);
    const statusNode = doc.getElementById('pwa-status'), reason = doc.getElementById('pwa-reason');
    const shellId = doc.querySelector('meta[name="fluid-shell-id"]')?.content;
    let detection, activation, lastActiveIdentity;
    let registration, epoch = 0, wasReady = false, deferredPrompt = null;
    function show(state, text) {
      panel.dataset.state = state;
      statusNode.textContent = {ready:'Готово до роботи offline', preparing:'Підготовка offline', unavailable:'Offline недоступний'}[state];
      reason.textContent = text;
    }
    async function verify() {
      const ownEpoch = ++epoch, controller = root.navigator.serviceWorker?.controller;
      show(controller ? 'preparing' : 'unavailable', 'Перевіряємо локальну підготовку. Реєстрація сама по собі не означає готовність.');
      try {
        registration = await root.navigator.serviceWorker.getRegistration('/');
        if (ownEpoch !== epoch) return;
        if (!controller) { show('preparing', 'Ця сторінка ще не контролюється offline worker. Після підготовки можна самостійно перезавантажити сторінку, спершу зберігши роботу.'); return; }
        const status = await requestStatus(controller);
        if (ownEpoch !== epoch || controller !== root.navigator.serviceWorker.controller) return;
        const state = readiness({controller, active:registration?.active, status, shellId});
        show(state, state === 'ready' ? 'Локальний shell цієї версії перевірено. Це не резервна копія малюнка.' : wasReady || status.complete === false ? 'Локальна підготовка відсутня або втрачена. Кеш міг бути очищений; потрібна повторна підготовка online. Причину видалення визначити неможливо.' : 'Версію цієї сторінки та активного worker не підтверджено. Offline-запуск не гарантований.');
        wasReady = state === 'ready' || wasReady;
      } catch (error) { if (ownEpoch === epoch) show('unavailable', 'Не вдалося підтвердити offline-готовність. Мережа чи реєстрація не є доказом готовності; спробуйте перевірити знову online.'); }
    }
    function installUI() {
      const mode = installMode(root.navigator, root.matchMedia('(display-mode: standalone)').matches || root.navigator.standalone, deferredPrompt);
      const button = doc.getElementById('pwa-install'); button.hidden = mode !== 'prompt';
      doc.getElementById('pwa-install-info').textContent = {standalone:'Застосунок уже відкрито в окремому вікні.', ios:'На iPhone / iPad відкрийте у Safari: Поділитися → На початковий екран (Add to Home Screen). Автоматичної установки немає.', fallback:'Якщо браузер підтримує встановлення, скористайтеся його меню «Встановити» / «Додати на початковий екран». Якщо пункту немає, працюйте у вкладці.', prompt:'Встановлення відкриває системний діалог лише після вашого натискання. Воно не зберігає малюнок.'}[mode];
    }
    root.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; installUI(); });
    root.addEventListener('appinstalled', () => { deferredPrompt = null; installUI(); });
    doc.getElementById('pwa-install').onclick = async () => {
      const prompt = deferredPrompt; deferredPrompt = null; installUI();
      if (!prompt) return;
      try { await prompt.prompt(); await prompt.userChoice; } catch { /* unsupported/cancel remains usable */ }
    };
    installUI();
    if (!root.isSecureContext || !('serviceWorker' in root.navigator)) { show('unavailable', 'Цей браузер або з’єднання не підтримує offline worker. Працюйте online.'); return; }
    doc.getElementById('pwa-verify').onclick = verify;
    root.navigator.serviceWorker.addEventListener('controllerchange', verify);
    doc.addEventListener('visibilitychange', () => { detection?.visibility(); if (!doc.hidden) verify(); });
    root.addEventListener('online', () => { verify(); detection?.check('online'); });
    verify();
    root.navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'}).then(r => {
      registration = r;
      const broadcast = typeof root.BroadcastChannel === 'function' ? new root.BroadcastChannel('fluid-pwa-update') : null;
      if (broadcast) broadcast.onmessage = () => { doc.getElementById('pwa-update-note').textContent = 'Інша вкладка готує оновлення. Ця вкладка не перезавантажиться без вашої згоди.'; };
      activation = createActivation({registration:r, container:root.navigator.serviceWorker, storage:root.sessionStorage,
        loadedShell:shellId, safety:() => root.__painter?.getUpdateSafety(), send:requestCommand,
        reload:() => root.location.reload(),
        lock:value => { if(root.__painter) root.__painter.updateApplying=value; doc.body.inert=value; },
        notify:async target => {
          broadcast?.postMessage({type:'UPDATE_NOTICE',releaseId:target});
          try { const reply=await requestCommand(r.waiting,{type:'CLIENTS',releaseId:target});
            doc.getElementById('pwa-clients').textContent=`Відкрито ще ${Math.max(0,reply.count-1)} вкладок (включно з uncontrolled). Закриття рекомендоване, але відповіді не потрібні. «Оновити все одно» не перезавантажує їх.`;
          } catch { doc.getElementById('pwa-clients').textContent='Інші вкладки не відповіли. «Оновити все одно» доступне; це не блокування.'; }
        },
        render:state => { const box=doc.getElementById('pwa-consent');box.hidden=['idle','verified'].includes(state.phase);
          panel.dataset.activation=state.phase;doc.getElementById('pwa-activation-status').textContent=state.message;
          doc.getElementById('pwa-saved').hidden=!state.exported;
          for(const id of ['pwa-export','pwa-saved','pwa-discard']) doc.getElementById(id).disabled=state.phase!=='confirm';
          if(state.phase==='verified')doc.getElementById('pwa-update-note').textContent=state.message;
        }});
      activation.verifyLoaded();
      doc.getElementById('pwa-apply').onclick=()=>activation.begin();
      doc.getElementById('pwa-export').onclick=()=>activation.export(()=>root.__painter.save());
      doc.getElementById('pwa-saved').onclick=()=>activation.allow('saved');
      doc.getElementById('pwa-discard').onclick=()=>activation.allow('discard');
      doc.getElementById('pwa-cancel').onclick=()=>activation.cancel();
      detection = createDetection({registration:r, container:root.navigator.serviceWorker, visible:() => !doc.hidden, render:state => {
        panel.dataset.update = state.phase;
        doc.getElementById('pwa-update').textContent = {idle:'Оновлення', checking:'Перевіряємо оновлення', downloading:'Завантажуємо оновлення', ready:state.later ? 'Оновлення відкладено' : 'Оновлення готове', failed:'Не вдалося перевірити / підготувати оновлення'}[state.phase];
        doc.getElementById('pwa-progress').hidden = !['checking','downloading'].includes(state.phase);
        doc.getElementById('pwa-versions').textContent = `Активна версія: ${state.active || 'не підтверджено'}. Очікує: ${state.waiting || 'немає підтвердженої'}.`;
        doc.getElementById('pwa-last-check').textContent = `Остання перевірка: ${state.lastCheck === null ? 'ще не було' : new Date(state.lastCheck).toLocaleTimeString()}. ${state.result}`;
        doc.getElementById('pwa-apply').hidden = !state.waiting;
        doc.getElementById('pwa-later').hidden = !state.waiting || state.later;
        if (state.active && state.active !== lastActiveIdentity) { lastActiveIdentity = state.active; verify(); }
      }});
      doc.getElementById('pwa-check').onclick = () => detection.check('manual');
      doc.getElementById('pwa-later').onclick = () => detection.later();
      detection.check('startup');
      verify();
    }).catch(() => show('unavailable', 'Online-підготовка не завершилась. Перший offline-запуск не гарантований.'));
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once:true}); else start();
}(typeof window !== 'undefined' ? window : globalThis));

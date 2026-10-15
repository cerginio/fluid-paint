/* Production-only readiness/install UX. No update or activation commands. */
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
  function installMode(nav, standalone, prompt) {
    if (standalone) return 'standalone';
    if (/iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios';
    return prompt ? 'prompt' : 'fallback';
  }
  if (typeof module !== 'undefined') module.exports = {readiness, requestStatus, installMode};
  if (!root.document) return;
  const doc = root.document;
  function start() {
    // Embedded host owns its UI; no additional overlay or install solicitation.
    if (root !== root.top || new URLSearchParams(root.location.search).get('embedded') === '1') return;
    const panel = doc.createElement('details'); panel.id = 'pwa-panel';
    panel.innerHTML = '<summary>Offline / встановлення<span class="pwa-summary-warning">Перезапуск не відновлює малюнок, мокру фарбу й Undo. Спершу збережіть PNG.</span></summary><div class="pwa-content"><p id="pwa-status" role="status" aria-live="polite"></p><p id="pwa-reason"></p><p id="pwa-warning"><strong>Перед перезавантаженням або оновленням збережіть PNG.</strong> Offline-перезапуск не відновлює малюнок, мокру фарбу та історію Undo. PNG зберігає лише пласке зображення.</p><p>Перший запуск без мережі потребує попередньої online-підготовки. Браузер може видалити локальні дані; після очищення потрібна повторна підготовка online.</p><button type="button" id="pwa-verify">Перевірити offline-готовність</button><p id="pwa-install-info"></p><button type="button" id="pwa-install" hidden>Встановити застосунок</button></div>';
    doc.body.appendChild(panel);
    const statusNode = doc.getElementById('pwa-status'), reason = doc.getElementById('pwa-reason');
    const shellId = doc.querySelector('meta[name="fluid-shell-id"]')?.content;
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
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) verify(); });
    root.addEventListener('online', verify);
    verify();
    root.navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'}).then(r => {
      registration = r;
      // Observe initial installation only; no update(), activation, claim or reload.
      if (r.installing) r.installing.addEventListener('statechange', verify);
      verify();
    }).catch(() => show('unavailable', 'Online-підготовка не завершилась. Перший offline-запуск не гарантований.'));
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, {once:true}); else start();
}(typeof window !== 'undefined' ? window : globalThis));

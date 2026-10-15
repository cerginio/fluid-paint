# Фаза 5 — readiness та install UX

Стан на 2026-10-15: **прийнято власником через `handoff:next`, фазу 5 закрито**.
Baseline `feba36060fbda60783311cdd9e8d8b6ca7ca3db4`. Closing commit поверх baseline; deploy не виконано.
Фази 1–4 лишаються прийнятими. Фази 6–10 не починались.

## Контракт і source tracing

- `app/pwa-register.js`: Gulp включає файл лише до production bundle
  (`gulpfile.js`, `scripts()`). Source HTML його не вантажить; actual dev build
  перевірено retained production probe. Embedded iframe / `embedded=1` не
  отримує нову панель чи install solicitation; host UI не перехоплюється.
- `debug/pwa-release-build.js`, `finalizeRelease()`: після hashing і переписування
  всіх HTML references обчислюється `shellId = SHA256(HTML до вставки token)`.
  У final HTML вставляється `meta[name=fluid-shell-id]`, і вже цей HTML входить
  у canonical inventory/releaseId. Token охоплює HTML та hash-named JS/CSS/
  manifest/icon references (fonts — через CSS); немає self-referential releaseId.
  `shellId` додається до pinned SW inventory, не береться з latest `/release.json`.
  Guard реконструює байти HTML без meta і перевіряє digest; changed HTML змінює
  token. Retained release suite доводить determinism/content sensitivity.
- `app/pwa-worker.js`: той самий STATUS protocol повертає додатково pinned
  `shellId`, поряд із `releaseId` і `complete`. Routing/install не переписано.
- Readiness питає **саме поточний controller**, а не довільний active/waiting SW.
  Ready потребує object identity `controller === registration.active`, стану
  `activated`, `complete === true`, валідної release identity та збігу pinned
  shell token із завантаженим HTML. UUID/requestId, stale-ID filter, 2000ms
  deadline, port cleanup, epoch та повторна controller-identity перевірка
  не дають запізнілій відповіді підтвердити іншу сторінку/controller.
- Реєстрація та перший uncontrolled page ніколи не означають ready. Немає
  `registration.update()`, `skipWaiting()`, `clients.claim()` чи app reload.
  «Перевірити offline-готовність» перевіряє локальний STATUS, не шукає update.
  Foreground/online перевіряють readiness без мережевого update machinery.
- `app/layout.css`: непрозорий disclosure внизу ліворуч, bounded width/scroll,
  native details/summary, live status, focus-visible, кнопки ≥44px. Коротке
  попередження про втрату малюнка/wet/Undo видно **навіть у згорнутому стані**;
  розгорнутий текст пояснює flattened PNG, перший online install і storage loss.
- Install button видима тільки після справжнього `beforeinstallprompt` і викликає
  збережений одноразовий event лише в click handler. Unsupported browser має
  menu/tab fallback; iPhone/iPad — Safari → Поділитися → Add to Home Screen.
  Standalone mode не пропонує повторної установки (guard; physical NOT TESTED).

## Історичний eval реалізації

Runnable з кореня checkout: `node debug/pwa-phase5-eval.js`.
Всі builds/guards/probes послідовні через shared `dist`; прямі Node entrypoints.

Evidence root **поза repo**:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase5-final-bUqgxL/`.
Root `result.json` має exact executable/args/cwd/env, stdout/stderr paths,
exit codes, окремі suites, browser results та перевірені ports.
**18 команд, кожна exit 0; runner exit 0 / status PASS.**

Guard (окремі suites, не сумувати з браузером): readiness **11/0**, worker
**10/0**, release **4/0**, assets **7/0**, harness **5/0**, shader **25/0**,
demo **8/0**, palette **6/0**. Control API PASS без enumeration.
Production builds PASS; `git diff --check` PASS.

Browser: Chromium **153.0.8010.12**, SwiftShader; Node **24.19.0**.

- `readiness-browser/result.json`: **13 cases PASS / 0 failed**, 5 повністю
  закритих persistent browser processes, 0 page errors. Свіжий never-prepared
  profile offline не вантажить shell; fresh online registration лишається
  uncontrolled/preparing; explicit QA reload дає ready від actual SW.
- Actual production worker відповідає потрібними releaseId/shellId/complete;
  інший shell token відхиляється у контрольованому diagnostic document із
  **реальним** controller (не удаваний V1→V2 release test).
- 320px geometry/keyboard/visible collapsed warning PASS. Desktop та iOS-UA
  screenshots переглянуто; текст читабельний. Панель згортається для малювання.
- Browser повністю закрито, той самий profile запущено offline **до першого
  navigation**, HTTP response `fromServiceWorker=true`, verified ready PASS.
- Справжній CacheStorage delete → local recheck unavailable із поясненням втрати
  підготовки. Cache-only wipe + reload **очікувано відхиляється worker fail-closed**:
  не обіцяємо автоматичне відновлення чи UI там, де shell уже недоступний.
- CDP `Storage.clearDataForOrigin(storageTypes=all)` + close/restart + online
  navigation → uncontrolled/preparing, не ready; generic disclosure пояснює
  повторну online-підготовку. Після повного wipe немає surviving evidence,
  тому застосунок **не вигадує**, що знає історію чи причину очищення.
  Наступний explicit user reload після online install повертає verified ready.
- Genuine native prompt **не надійшов** (`nativePromptOffered=false`): actual
  Chromium fallback перевірено, system-dialog acceptance NOT TESTED, synthetic
  event не видавався за native proof. iOS UA preview показує manual A2HS,
  install button hidden; це **Chromium, не Safari і не фізичний iPhone**.
- Retained production SW probe **10/0**: WebGL1/2 offline draw/resize/Bake/export/
  local import/playback subset, failed network/404 upgrades, embedded handshake,
  natural activation; 5 browser closures. Assets **2 viewport**, release
  **2 WebGL**, disposable fixture **8 cases** PASS. Не складати suites в одне число.

### Artifacts

У `readiness-browser/`: frozen `dist-snapshot/`, `profile/`,
`never-prepared-profile/`, `server.jsonl`, `result.json`; 5 HAR та 5 trace ZIP
(по одному на process label). Real screenshots:

- `first-uncontrolled.png`
- `desktop-ready.png`
- `mismatched-shell-refused.png`
- `320-ready.png`
- `320-warning-collapsed.png`
- `cold-offline-ready.png`
- `cache-wipe-unavailable.png`
- `site-wipe-reloaded-uncontrolled.png`
- `ios-ua-instructions.png`

Retained browser artifacts лежать у `production-regression/`,
`assets-regression/`, `release-regression/`, `fixture-regression/`; exact result
paths — root result. Review server не залишено. Own servers/browsers закриті;
ports **53545, 56206, 51878, 53571, 55120, 64528** independently bind-back
окремим Node process PASS (`independent-bind-back.stdout.log`). Чужих не чіпали.
Додатковий runnable readback: `node C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase5-final-bUqgxL/verify-evidence.js`;
Історичний post-document readback був PASS (пізніший FAIL нижче): 18 команд exit 0, signatures/nonempty HAR/trace
для 88 media artifacts, 9 readiness PNG / 5 HAR / 5 traces, document links і
post-document `git diff --check`; повторний bind-back усіх 14 ports власних
final/intermediate/scratch runs PASS. Один пізній bind спочатку дав Windows
EACCES (netstat показав не listener, а reused outbound TIME_WAIT); повторний
bind пройшов без зупинки будь-яких чужих процесів.

## Parent readback після delivery

Readiness guard повторно виконано: **11/0**; root/probe results та всі
88 media artifacts повторно прочитано. Скриншоти 320px collapsed warning та
iOS-UA instructions переглянуто parent; текст читабельний. `git diff --check` PASS.
Повний eval не перезапускався.

Повторний `verify-evidence.js` тепер **FAIL тільки на пізньому scratch-порту
51879**: Windows EACCES; перед цим 13 портів bind-back PASS, включно з усіма
шістьма final-run ports вище. Поточний `netstat -ano`: цей локальний порт
зайнятий outbound TCP `192.168.1.224:51879 → 65.9.62.102:443`, ESTABLISHED,
PID 52300, а не review listener. Процес не зупиняли. Попередній PASS 14 ports
є історичним; поточний `verified-evidence.json` чесно зберігає FAIL.
Це не failure readiness/browser cases і не залишений review server.

## Знайдене та виправлене

Перший integrated eval `fluid-pwa-phase5-final-O3IG3c` виявив **справжню UI
регресію**: верхня PWA панель перекривала State tab. Перенесено disclosure
вниз ліворуч, retained browser clicks не force-натискались і не обходились.
Повний final eval вище пройшов на виправленому layout; попередній FAIL — не
acceptance evidence. Intermediate `viAyMQ` PASS перед фінальними додатковими
snapshot/guard/fresh-offline checks superseded `bUqgxL`.

**Новий інваріант:** readiness не можна підтвердити реєстрацією, чужим release
чи лише latest metadata; collapsed PWA warning не має блокувати основні story
controls. Механізм: loaded-shell token + actual-controller STATUS; guards
`pwa-readiness-test.js`, probes `pwa-readiness-browser-test.js` і retained
`pwa-worker-browser-test.js` (State/Bake clicks).

## Межі / NOT TESTED

Фізичні Android/iOS, справжній Safari/A2HS/standalone cold launch, native GPU,
OS reboot, browser quota exhaustion/MIME/hash/HTML injection та автоматична
storage eviction, persist refusal, full large-story completed playback,
live CDN/headers/CORS/demo downloads, full `make verify` — **NOT TESTED**.
Exact-worker Node rejection branches та explicit cache/site-data delete не
видаються за browser quota/eviction proof. Standalone policy перевірено guard,
не фізичним запуском. Немає вічної гарантії storage чи automatic drawing restore.
Фази 6–10 (update detection/activation, headers, retention/cap/rollback,
offline demos/release QA) не реалізовані. Physics/palette/vendor та Netlify/prod
не змінено. Наступний крок — фаза 6 після окремого дозволу. [QA.md](./QA.md).

## Closing check

Closing check 2026-10-15: production build PASS; свіжі окремі guards:
readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**, harness **5/0**.
Browser evidence повторно прочитано без перезапуску: історичні readiness 13 cases,
production 10 cases, assets 2 viewport, release 2 WebGL, fixture 8 cases — PASS.
Native install/iOS-device та всі NOT TESTED межі збережено. Scratch-port
readback EACCES з попереднього parent review лишається disclosed, не browser FAIL.

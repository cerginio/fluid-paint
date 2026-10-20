# Фаза 7 — безпечна активація та захист роботи

> **Історичний snapshot закриття фази 7.** Нижче `7A не реалізовано/не авторизовано`
> описує лише стан того closure. Поточну 7A авторизовано відповіддю `7a`,
> реалізовано й передано на review, НЕ прийнято: [PHASE7A-REPORT.md](./PHASE7A-REPORT.md).
> Фаза 8 як і раніше заблокована.

Стан на 2026-10-15: **прийнято власником через `handoff:next`, фазу 7 закрито із UX follow-up 7A**.
Closing commit поверх `5d900c1`; фази 1–7 прийняті. Preview/production deploy не виконано.
Наступний крок — окремий дозвіл на **7A перед 8**, не реалізація фази 8.
7A зараз лише контракт/checklist у [HANDOFF](./HANDOFF.md) та [QA](./QA.md).
Фазу 8 не починати до реалізації, eval і acceptance 7A та окремого дозволу.

## Closing check фази 7 — 2026-10-15

Прийняття власником — acceptance із збереженим боргом, не нове physical/full QA.
Свіжий closing eval виконано в isolated source clone поза repo, щоб не
перебудовувати `dist`, який обслуговує живий стенд. Build PASS; inventory та
releaseId byte-identical retained V1
`4e6ce90e534c2b1929546a183156178cf28eb3571815375bfcf3d4ddbd996eb2`.
Свіжі guards passed/failed окремо: activation **12/0**, detection **15/0**,
readiness **11/0**, worker **12/0**, release **4/0**, assets **7/0**, harness
**5/0**, shader **25/0**, demo **8/0**, palette **6/0**; control API PASS без
enumeration. 12 closing commands exit 0 (build + 10 suites + control), не сума tests.
Evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-closure-01eEQx/result.json`.

Browser probes не перезапускались: повторно прочитано historical final result,
22 exit codes/log paths і 7 probe results PASS; activation **14/0**, detection
**7/0**, readiness **13/0**, production **10/0**, assets **2 viewport**, release
**2 WebGL**, fixture **8 cases** — історичні. Production sources SHA-exact до
frozen evidence (V2 fixture label повернуто до V1 лише для порівняння).
Cleanup verifier FAIL/EACCES стороннього 51333 з parent-readback лишається
обмеженням; жодного нового global free-port claim чи зупинки чужого процесу.

**Живий built stand збережено за прямою вимогою власника:**
`http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`.
Fresh listener readback: actual `node.exe` PID **31212**, parent **70768**,
command `node_modules/gulp/bin/gulp.js startServer` (wrapper PID 17540 не owner).
Fresh HTTP readback: усі **19 inventory entries** HTTP200/SHA-exact і `/sw.js`
HTTP200/exact local SHA. Це single V1 review stand, не live V1/V2 upgrade/CDN proof.
Під час closure сервер не зупиняли, served dist не переписували. Попередня parent
спроба rebuild впала через missing font; clean retry PASS, не «без невдалих спроб».
Deploy відсутній; усі NOT TESTED межі збережено. 7A зараз лише контракт, не UX code.

## Обов’язковий UX follow-up 7A перед 8

Compact icon-first PWA UX, minimum visible text, English default. Localization
reuse лише якщо вже існує; без додавання framework/requirement за його відсутності.
IDs/technical details — secondary disclosure. Concise English loss-consent,
separate PNG/file confirmation/discard і accessible names/tooltips/keyboard
обов’язково зберегти. Повний контракт/checklist — [HANDOFF 7A](./HANDOFF.md),
planned acceptance — [QA 7A](./QA.md). Це documentation-only follow-up: чекати
`start 7A`, потім implementation/eval/owner acceptance; лише після цього можна
окремо дозволити фазу 8. UX тут ще не реалізовано.

## Production контракт і source tracing

- `paint.js#getUpdateSafety()` — production API, не DOM-евристика й не probe-only
  прапорець. Перевіряє `manualStrokeActive`, `engine.strokeActive`,
  `_manualInputPending`, `interactionState`, лічильник реальних async operations;
  у `StoryPlaybackController` — `state` loading/playing/paused,
  `backgroundLoading` та `_runPromise`. Немає повного persistent dirty/checkpoint
  API: **dirty завжди `unknown`**, навіть для чистого на вигляд полотна. Unknown
  ніколи не прирівнюється до saved. Відсутній painter/controller/API — fail-closed.
- `exportPngBlob`, `save`, `loadBackgroundImage`, `decodeBackground`,
  `bakeToBackground` мають `try/finally` operation counter. `exportPngBlob`
  **await**-ить browser `toBlob` перед зменшенням counter. `save()` викликає
  реальне flattened PNG завантаження; завершення Promise не доводить запис файлу.
  Імпорт story JSON має production `loading`, PNG — `backgroundLoading` та
  painter counter; Bake очікує чинний `yieldToManualInput()` усередині counter.
  Physics, palette та vendor не змінено.
- `app/pwa-register.js#createActivation()` — той самий production factory,
  який запускають Node guards. «Оновити» при active work лише відмовляє: мазок
  не обрізається, playback не pause/stop автоматично. Треба природно завершити
  мазок/операцію; для paused playback — явно Stop та Keep/Restore, потім повторити.
  Лише власна сторінка може блокувати її підтвердження.
- Перед allow завжди окремий consent з описом втрати мокрої фарби та Undo.
  «Завантажити PNG» **не активує** worker. Після успішного export окрема кнопка
  «PNG збережено — оновити все одно» означає перевірку файлу користувачем.
  Альтернатива — «Оновити без збереження — оновити все одно». Cancel/export
  failure/active work/stale candidate/storage refusal не дають ALLOW.
- `CLIENTS` використовує actual `clients.matchAll({type:'window',
  includeUncontrolled:true})` і same-scope filter. BroadcastChannel — лише
  notification. Немає reply quorum, lease, timeout-lock чи очікування згоди
  інших вкладок. Рекомендація закрити інші вкладки не прибирає explicit anyway.
- Worker приймає `ALLOW_UPDATE` лише від actual same-scope WindowClient,
  для власного exact releaseId та complete cache. Тільки ця гілка викликає
  `skipWaiting`; `clients.claim` і install-time forced activation відсутні.
- Перед send записується tab-local `sessionStorage` marker. Own UI стає inert,
  нові painter import/export/Bake відмовляються до переходу; помилка знімає lock.
  **ACK не є controllerchange**: ранній STATUS до старого controller не робимо.
  Лише actual controllerchange + complete target identity споживає marker
  (`reloaded:true`) **до** одного reload. Інші вкладки reload не виконують.
  Після navigation actual worker shellId звіряється з pinned HTML meta, отриманий
  releaseId — з marker; mismatch повідомляється без повторного reload.
- Мінімальна phase-7 compatibility routing: новий worker знаходить старий
  content-addressed asset лише у committed власному namespace, перевіряє SHA
  байтів проти імені й не служить старий HTML. Current incomplete shell лишається
  fail-closed. Невідомий hash-shaped path — uncached network-only, без HTML fallback.
  Старі caches не видаляються. **Cap/cleanup/liveness protocol/rollback — НЕ фаза 7**.

## Історичний повний phase eval реалізації

Із `D:/work/fluid-paint/fluid-paint`, без інших dist writers:

```sh
node debug/pwa-phase7-eval.js
# Вузький повтор:
NODE_ENV=production node node_modules/gulp/bin/gulp.js build
node --test debug/pwa-activation-test.js
node debug/pwa-activation-browser-test.js
```

Final **PASS / exit 0**, **22 top-level commands exit 0**. Exact executable,
args, cwd, env, stdout/stderr та codes — root result:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J/result.json`.
Node 24.19.0, Chromium 153.0.8010.12, SwiftShader. Ці числа історичні, не повторний closing run; числа
попередніх фаз у старих секціях HANDOFF/QA — історичні. Не сумувати suites.

Guard passed/failed окремо:

- activation **12/0**; detection **15/0**; readiness **11/0**;
- worker **12/0**; release **4/0**; assets **7/0**; harness **5/0**;
- shader **25/0**; demo **8/0**; palette **6/0**; control API PASS без enumeration.

Browser suites окремо:

- activation **14/0**;
- detection **7/0**; readiness **13/0**;
- production regression **10/0**;
- assets **2 viewport PASS**; release **2 WebGL PASS**; fixture **8 cases PASS**.

Retained production probe реально виконує source/dev exclusion, offline cold
WebGL1/2 draw/resize/Bake/PNG/local import, bounded completed story playback,
failed network/404 install, query/embedded origin/window checks та **natural
activation після закриття всіх clients**. Не змінено їх acceptance на mocks.
Старі blanket no-phase7 assertions замінено scoped no-claim, pinned identity,
ALLOW-only та actual source/worker factory guards, не просто вилучено.

## Actual production V1/V2 evidence

`$E = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J`
і `$R = $E/activation-browser` — абсолютні каталоги поза repo.
Historical URL цього final run:
`http://127.0.0.1:51333/?webgl=2&debug=none&diag=0&seed=41`.
Сервер уже зупинено; це не live review stand.

- V1 `4e6ce90e534c2b1929546a183156178cf28eb3571815375bfcf3d4ddbd996eb2`;
- V2 `699be88cc7ab9d5df2604b71d15dc35e5cbe35aad5ed35d6c62ec37238139cb0`.

Два реальні production builds: frozen `v1/`, `v2/`, modified source fixture,
один origin, persistent `profile/`, actual SW/CacheStorage. V2 змінює HTML title
та bundled UI label, не engine. Bootstrap V1 вкладка лишається **uncontrolled**;
інша V1 вкладка контролюється й малює, третя не дає згоди. Notification count
«ще 2» включає uncontrolled. BroadcastChannel не перезавантажує жодну з них.

Фактичний pointer stroke тримається натиснутим під час DOM activation click:
стан active=true і strokeActive=true після відмови; pointer up завершує мазок.
Це навмисний DOM click, бо звичайний mouse click спершу відпустив би перо.
Dirty cancel та actual `toBlob(null)` error залишають V1 active/V2 waiting.
Real export затримано лише на browser encoder callback; real Bake — на його
async yield boundary; real local import — на File.text. Це **timing instrumentation
реальних production operations**, не synthesized PNG/API responses. Після
відмови всі операції справді завершуються. Actual story playback лишається
playing; потім QA явно Stop/Keep, не updater.

PNG `confirmed-artwork.png`: справжній download, **180×130, 17811 bytes**, signature
та dimensions перевірені; API completion ще не activate. Після окремого click
першої вкладки V2 активна, loaded shell/release verified, navigation count=**1**.

Для детермінованого race runner **тримає доставку справжнього ALLOW message**,
поки нова вкладка відкриває pinned V1 HTML; потім відпускає повідомлення. Це
applying/pre-ALLOW window, не заява про вимірювання довільного nanosecond race.
Після activation цей старий документ далі живий, а old-hash JS fetch offline
через новий worker має exact V1 SHA. Друга вкладка реально frozen через CDP
`Page.setWebLifecycleState`; V2 active/verified зафіксовано **до її resume**.
Немає client-response lock. Це Chromium freeze, не physical mobile suspension.
Uncontrolled документ не claimed й не reload. Обидва complete inventories
перевірені SHA-exact. Marker після reload відсутній, через додаткове очікування
navigation count все ще 1.

Усі 4 вкладки й browser process закрито. **Той самий profile** запущено знову,
offline встановлено до navigation: V2 HTTP response fromServiceWorker=true.
Окремий `discard-profile/` на тому самому origin реально проходить explicit
update-without-saving без export і теж перевіряє loaded V2.

У `$R`: `result.json`, `cache-snapshot.json`, `server.json`, `browser.json`, frozen
builds/profiles, **13 PNG** (12 screenshots + 1 artwork), **3 HAR / 3 trace ZIP**.
Скріншоти consent/verified та справжній artwork перевірено візуально. Три own
persistent processes disconnected: activation (4 tabs), cold-v2 (1), discard (1).
Final owned ports **57245/61163/61694/61152/53415/59252/59027/51333** перевірені
окремим Node bind-back command у root result. Чужих процесів не зупиняли.

## Виявлені дефекти та невдалі спроби

- Scratch `tJ6hZz`: counter спочатку виходив із finally перед завершенням
  Promise export. Виправлено `return await`; actual held encoder тепер захищено.
- `tEGHYn`: probe помилково вважала yield закінченням playback; production
  правильно лишає paused active. QA тепер явно Stop/Keep після перевірки refusal.
- `5cwtWU`, `5d6kyE`, `E4NI2g`, `8R8PPd`, `YYRgFq`: ранній STATUS до старого
  controller після ACK спричиняв незавершений transition у Chromium. Прибрано
  eager check; лише controllerchange перевіряє target. Додано factory regression.
- Один scratch diagnostic `await skipWaiting()` завис і terminal timeout завершив
  процес; його незавершені artifacts **не є PASS**. Наступні runners cleanup PASS.
  Мінімальні direct-message/UI probes лишаються diagnostic, не suite count.
- `final-LH7p3C` — проміжний повний PASS до фінального network-only routing
  уточнення. `final-Kl733t` та `final-YXxpJs` — FAIL у retained readiness probe:
  assertion читала transient reason під час повторної startup verify. Guard не
  послаблено: тепер atomic snapshot чекає idle + exact uncontrolled reason + null
  controller. Фінальний **повний rerun MsWR9J** усіх suites PASS.
- Background terminal launch не виконав runner (`stdin is not a tty`); final
  виконано foreground. Ні один failed/intermediate результат не додається до final.

## Нові інваріанти

1. Promise export лишається active до фактичного encoder completion; finally не
   може відпустити update gate раніше. Production API guard + held real export probe.
2. ACK не замінює controllerchange; reload тільки consented tab, exact complete
   target, one-shot session marker. Production factory guard + actual V1/V2 probe.
3. Suspended/uncontrolled/новий client не є lock; nonconsenting document зберігає
   старі hash bytes під новим SW. Exact-worker guards + frozen/race/offline probe.

## Повний змінений scope та фінальний readback

Змінені/нові repository paths (generated dist/evidence не входять):

- `Makefile`;
- `app/pwa-register.js`;
- `app/pwa-worker.js`;
- `debug/pwa-activation-browser-test.js`;
- `debug/pwa-activation-test.js`;
- `debug/pwa-assets-test.js`;
- `debug/pwa-phase7-eval.js`;
- `debug/pwa-readiness-browser-test.js`;
- `debug/pwa-readiness-test.js`;
- `debug/pwa-worker-test.js`;
- `docs/spec/fluid-pwa/HANDOFF.md`;
- `docs/spec/fluid-pwa/PHASE7-REPORT.md`;
- `docs/spec/fluid-pwa/QA.md`;
- `package.json`;
- `paint.js`;

`node C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J/verify-evidence.js`
після документування: PASS. `post-document-verification.json` перевіряє 22 exact
command codes/logs, окремі suite/case counts, signatures/JSON **118 media artifacts**,
обидва exact cache inventories, current production sources проти frozen source,
current dist identity V1, нові document links/13 QA headings, HEAD `5d900c1` та
порожній index. Окремий Node process bind-back **усіх 45 ідентифікованих власних
final/scratch ports PASS**; зокрема origin timed-out
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-probe-hY0mok/` відновлено з
persistent Service Worker database, а не вигадано. Own node/browser leftovers
відсутні за exact-profile/command process readback (сам verifier виключено).
`post-document-bind.stdout.log` / `.stderr.log` та точна команда — поруч.

Зображення V2 після reload показує collapsed warning/мітку V2; статус verified
доведено actual dataset + pinned STATUS у JSON, не приписано невидимому тексту
на collapsed screenshot. Real PNG непорожній; consent controls та повні IDs
читабельні, панель має internal scroll. Це browser/API evidence, не human acceptance.
Busy import/Bake/playback probes викликають production API з браузера; trusted
pointer stroke й DOM consent/export/discard окремо відзначені в cases. Retained
production suite має власні actual UI checks.

### Незалежна parent-перевірка після handback

Повторні focused guards: activation **12/0**, worker **12/0**; `git diff --check` PASS.
Readback перевірив 22 command codes, suite/probe counts, 118 media artifacts,
cache inventories та відповідність production sources frozen evidence.
Повний повтор `verify-evidence.js` **FAIL на cleanup bind-back**, не browser case:
порт 51333 тепер зайнятий стороннім `DDPM.Subagent.User.exe` (PID 43012),
Node отримав EACCES. Exact process/network readback не знайшов phase-7
node/Chromium leftovers; сторонній процес не зупиняли. Попередній bind-back
усіх 45 портів є історичним PASS, не поточним твердженням про вільність.
`post-document-verification.json` тепер містить цей незалежний FAIL;
первинний final `result.json` і browser PASS незмінні. Consent PNG незалежно
переглянуто: окреме підтвердження збереження читабельне, artwork непорожній.

## NOT TESTED та залишені межі

Physical Android/iOS, real Safari/A2HS/standalone, native GPU, OS reboot, native
install dialog, real mobile suspended lifecycle/15-minute wall-clock, browser
quota/automatic eviction/MIME/hash fault injection, full великої story playback,
live Netlify/CDN headers, CORS/demo downloads, full `make verify` — **NOT TESTED**.
Node guards/UA preview/SwiftShader не є physical acceptance. Збереження PNG на
диску — окреме твердження користувача, не Promise і не wet/history checkpoint.
Повного dirty/recovery API немає; always-potentially-unsaved — свідома безпечна
межа. Фази 8–10 не реалізовані. Phase7 acceptance/closing commit авторизовані `handoff:next`; deploy і реалізація 7A/8 не авторизовані.

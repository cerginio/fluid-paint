# Handoff archive: фази 1–7

Архівовано 2026-10-15. Прийнято власником: фази 1–3 — 2026-10-14, 4–7 — 2026-10-15; фаза 7 із follow-up 7A.
Активний стан — [../HANDOFF.md](../HANDOFF.md); регресійні сценарії — [QA-phases-1-7.md](QA-phases-1-7.md); [живий QA](../QA.md).

Період зафіксував self-hosted assets, content-addressed release inventory, persistent SW harness, atomic install/routing, readiness/install UX, detection/headers і safe activation. 7A та retention/quota/rollback/offline demos/release QA не закриті.

Нижче точні історичні блоки без виправлення старих тверджень. Їхні literal relative links мали базу `docs/spec/fluid-pwa/`, а не `_archive/`; відповідні звіти лежать на рівень вище. Чинні залежності фази 7 лишено в живому HANDOFF. Метрики/сервери/PID — історичні, не нова перевірка.

# Handoff: Fluid PWA — offline shell та надійні оновлення

Стан на 2026-10-15. **Фаза 1 прийнята власником командою `handoff:next` і закрита.**
Фаза 1 закомічена в `67b9726`. **Фаза 2 прийнята власником командою
`handoff:next` 2026-10-14 і закрита; closing commit поверх `67b9726`.**
**Фаза 3 прийнята власником командою `handoff:next` 2026-10-14 і закрита;
код і closure-документи входять у closing commit поверх `ff429d4`.**
Production deploy не виконано.
На вході `git status --short --untracked-files=all` був порожній; сторонніх
правок не змінено. Фазування зі [спеки](./PWA-OFFLINE-UPDATE-SPEC.md)
(ревізія 2), historical baseline `55ed4a4`. Production origin
`https://fluid.storytilecraft.space`; production не змінено.


## Фаза 7 — прийнята й закрита із UX follow-up 7A

`paint.js#getUpdateSafety()` трасує actual stroke/interaction/manual pending,
реальні async export/import/Bake counters та story loading/playing/paused/run.
Повного dirty/checkpoint API немає: dirty **unknown**, отже потенційно незбережено.
Active stroke не обрізається: завершити природно й повторити update. Playback,
import/export/Bake updater не перериває. Export PNG completion не activate:
потрібна окрема перевірка файлу користувачем або explicit discard із втратою
wet/history. Відмова/помилка/stale identity/missing API/storage refusal не дають allow.

Production factory `createActivation` у `app/pwa-register.js`: CLIENTS actual
matchAll includeUncontrolled + BroadcastChannel notification, **не lock**.
Unresponsive clients не потребують reply, explicit anyway лишається. Worker
ALLOW bound до same-scope WindowClient/exact complete release, без claim чи
unconditional skipWaiting. Reload тільки requesting page після actual
controllerchange, one-shot sessionStorage marker до reload, pinned loaded
shellId/target releaseId verification після нього. ACK не є controllerchange.
Compatibility routing служить old SHA-named bytes із committed caches під новим
SW; old HTML не serve, unknown hashes network-only. **Cap/cleanup/rollback не додано.**

Історичний final `node debug/pwa-phase7-eval.js`: **PASS / exit 0; 22 commands exit 0**.
Guard окремо passed/failed: activation **12/0**, detection **15/0**, readiness
**11/0**, worker **12/0**, release **4/0**, assets **7/0**, harness **5/0**, shader
**25/0**, demo **8/0**, palette **6/0**; control API PASS без enumeration.
Browser окремо: activation **14/0**, detection **7/0**, readiness **13/0**,
production **10/0**, assets **2 viewport**, release **2 WebGL**, fixture **8 cases**.
Не сумувати suites/рівні. Старі phase-1–6 числа нижче — історичні.

Actual production V1/V2 persistent same-origin: real dirty stroke/cancel/PNG
error/pending export/Bake/import/playback gates, separate export confirmation,
explicit discard, uncontrolled included count, frozen nonconsenting tab,
applying-window old-shell tab, exact old hashes offline під V2, один own reload
та no loop. Той самий profile закрито/запущено offline до navigation: V2 cold
PASS. Retained regression зберігає natural activation без ALLOW після close.
Timing gates probe явно описані у report, не видаються за physical lifecycle.

Evidence поза repo:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J/`.
Root result має exact commands/logs/codes; activation-browser — frozen V1/V2,
profile, identities/caches/server/browser JSON, **13 PNG, 3 HAR, 3 trace ZIP**.
Final ports 57245/61163/61694/61152/53415/59252/59027/51333 окремим bind-back PASS.
Історично own browsers disconnected, eval servers stopped; тоді review stand не залишено. Поточний retained stand — у closing check нижче; чужих не чіпали.
Первинний post-document verifier: історичний PASS, 118 media artifacts;
45 own final/scratch ports тоді bind-back PASS. Незалежний parent readback
підтвердив commands/artifacts/caches/source та повторив guards activation 12/0,
worker 12/0. Повтор verifier FAIL лише на bind-back: 51333 тепер зайнятий
стороннім DDPM.Subagent.User.exe (PID 43012), EACCES; процес не чіпали.
Phase-7 node/Chromium leftovers не знайдено. Поточний
post-document-verification.json зберігає цей FAIL; browser final PASS незмінний.
Деталі — parent-readback.json у evidence та PHASE7-REPORT.md.


## Фаза 6 — прийнята й закрита

Прийнято власником через `handoff:next` 2026-10-15; closing commit поверх
`5d876c7`. Deploy не виконано. Далі фаза 7 після окремого дозволу.
Реалізація, історичний final eval та browser evidence — нижче.

`app/pwa-register.js`: detection factory із existing waiting до bootstrap,
updatefound/statechange/controllerchange/redundant, dedup/epoch/object guards та
active/waiting STATUS identity з request UUID/2000ms timeout. Startup,
foreground, online, manual та visible 15-minute registration.update(); auto
throttle 60000ms, concurrent coalescing, hidden stop, rearm після actual check
completion. Pinned-shell readiness/embedded exclusions/genuine install UX збережені.
UI: повні active/waiting IDs, last-check result/time, indeterminate progress,
чесний offline/failed result; «Пізніше» не activate/reload. Phase7 machinery немає.

`netlify.toml`: no-store SW+metadata, no-cache HTML. Immutable тільки **exact
generated SHA paths у dist/_headers**, створені release finalizer; не широкий
glob і не pseudo-regex у Netlify TOML. Fixed names ніколи не immutable.
Live CDN headers NOT TESTED (production deploy заборонено), локальний actual
HTTP readback не видається за Netlify validation. Naming/physics/palette/vendor незмінні.

`node debug/pwa-phase6-eval.js`: final PASS / exit 0, **20 top-level commands
exit 0**. Окремі guards passed/failed: detection **15/0**, readiness **11/0**,
worker **10/0**, release **4/0**, assets **7/0**, harness **5/0**, shader **25/0**,
demo **8/0**, palette **6/0**; control API PASS. Browser окремо: detection **7/0**,
readiness **13/0**, production **10/0**, assets **2 viewport**, release **2 WebGL**,
fixture **8 cases**. Не сумувати рівні/suites. Chromium 153.0.8010.12 / SwiftShader.

Два actual production builds на одному persistent localhost origin: V1 active,
V2 verified complete waiting. Actual JS404 -> redundant/failed; retry готовий.
Друга вкладка з already-waiting до UI bootstrap показує pinned V1 + V2 waiting.
«Пізніше» + offline check failure лишають V1 usable: actual stroke/PNG export,
no reload, loaded scripts V1-only, обидва inventories cache SHA-exact.
320px geometry/wrapping PASS. Retained regression cold offline/WebGL1/2/Bake/
local import/playback subset/embedded та install UX PASS.

Evidence поза repo:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase6-final-Bxucp5/`.
Root result.json має exact commands/codes/logs; detection-browser має frozen
v1/v2/source/profile, result/cache/server/browser JSON, 9 PNG, HAR та trace ZIP.
Own browsers disconnected, servers stopped; independent bind-back final ports
61749/52260/54432/49202/59812/64177/56608 PASS. Review stand не залишено.
Повний source tracing, історичні failed attempts і межі — [report](./PHASE6-REPORT.md).

Нові інваріанти: offline failure не стирається local STATUS; довга in-flight
перевірка не втрачає майбутній timer; immutable definitions лише full-SHA
inventory paths. Guard — pwa-detection-test.js (clock injected, не 15min wall-clock),
probe — pwa-detection-browser-test.js. NOT TESTED: physical Android/iOS/Safari/
A2HS/standalone, native GPU/OS reboot/install dialog, suspended/mobile wall-clock,
quota/eviction/browser MIME/hash faults, full large-story playback, live CDN/
CORS/demo downloads, full make verify. Фази 7–10 не реалізовані.


Closing check 2026-10-15: production build PASS; свіжі окремі guards detection
**15/0**, readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**,
harness **5/0**. Збережені browser results повторно прочитано без перезапуску:
detection **7 cases**, readiness **13 cases**, production **10 cases**, assets
**2 viewport**, release **2 WebGL**, fixture **8 cases** — історичні PASS.
Evidence readback PASS до closure edits: 20 command codes, 99 media artifacts,
всі final/scratch порти bind-back PASS. Всі NOT TESTED межі збережено.

## Фаза 5 — прийнята й закрита (історичний запис)

Прийнято власником через `handoff:next` 2026-10-15; closing commit поверх
`feba360`, deploy не виконано. [QA-5A–5I](./QA.md). Фаза 6 потребує окремого дозволу.
Нижчі записи «5–10 не починались» — історичний стан попередніх фаз,
який superseded цим live entry лише для реалізації фази 5.

`app/pwa-register.js` тепер production-only readiness/install controller.
Ready потребує verified complete precache, activated active worker, object
identity actual controller===active та pinned loaded-shell token; registration
success/uncontrolled page/timeout/wrong shell/cache wipe не дають ready.
Finalizer `debug/pwa-release-build.js` hash-ить переписаний HTML перед вставкою
`fluid-shell-id` meta; final HTML із token входить у release inventory. SW
STATUS повертає цей pinned shellId/releaseId/complete; UI не довіряє latest
network metadata. UUID, bounded timeout, stale reply/controller guards збережені.
Повний source tracing і межі — [PHASE5-REPORT.md](./PHASE5-REPORT.md).

Warning про втрату малюнка/wet/history видиме і у згорнутій панелі. Перший
online install, storage loss та flattened PNG пояснено без обіцянок recovery.
Install — тільки genuine event + user click; menu fallback/iOS A2HS/standalone
policy. Embedded UI не отримує overlay. No update/activation/reload machinery.

Runnable `node debug/pwa-phase5-eval.js`: final PASS, runner exit 0,
**18 commands exit 0**, builds/guards/probes послідовні. Історичні guards реалізації:
readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**, harness
**5/0**, shader **25/0**, demo **8/0**, palette **6/0**; control API PASS.
Browser: readiness **13/0** (5 persistent processes закрито), production
regression **10/0**, assets **2 viewport**, release **2 WebGL**, fixture **8 cases**.
Не сумувати suites/рівні. Chromium 153.0.8010.12 / SwiftShader, Node 24.19.0.

Fresh profile offline не вантажить shell; fresh online install лишається
uncontrolled/preparing до user reload; actual SW ready і cold offline browser
restart PASS. Cache delete відкликає ready; cache-only reload fail-closed
(немає неправдивого recovery UI). Full site-data wipe + online restart дає
preparing із generic поясненням, не вигадує історію очищення без доказів;
після повторної online-підготовки і user reload ready повертається.
Native install event не надійшов: fallback PASS, system dialog NOT TESTED;
iOS-UA preview — Chromium, не real Safari/device. 320px keyboard/geometry PASS.

Evidence **поза repo**:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase5-final-bUqgxL/`.
Root result має exact commands/exit codes; `readiness-browser/result.json`,
frozen dist/profile, 9 screenshots, 5 HAR/5 trace ZIP. Own browsers/servers
закриті; ports 53545/56206/51878/53571/55120/64528 незалежно bind-back PASS.
Review stand не залишено. Перший integrated FAIL виявив перекриття State tab;
панель перенесено вниз ліворуч, retained actual clicks тепер PASS без force.

**Новий інваріант:** тільки completed pinned shell actual controller може
дати ready; PWA warning не блокує основні story controls. Guards/probes:
`debug/pwa-readiness-test.js`, `pwa-readiness-browser-test.js`, retained
`pwa-worker-browser-test.js`. Physics/palette/vendor та Netlify/prod не змінено.

NOT TESTED: physical Android/iOS/Safari/A2HS/standalone, native GPU/OS reboot,
browser quota/automatic eviction/MIME/hash faults, full large-story completed
playback, live CDN/headers/CORS/demo downloads, full `make verify`. Standalone
policy — guard, не physical acceptance. Фази 6–10 не реалізовані.

Closing check 2026-10-15: production build PASS; свіжі окремі guards:
readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**, harness **5/0**.
Browser evidence повторно прочитано без перезапуску: історичні readiness 13 cases,
production 10 cases, assets 2 viewport, release 2 WebGL, fixture 8 cases — PASS.
Native install/iOS-device та всі NOT TESTED межі збережено. Scratch-port
readback EACCES з попереднього parent review лишається disclosed, не browser FAIL.

## Фаза 4 — прийнята й закрита

Прийнято власником через `handoff:next` 2026-10-15. Closing commit поверх
`66c65e1`; deploy не виконано. Production code: `app/pwa-worker.js` template,
`app/pwa-register.js` production-only inclusion у Gulp, final generated `/sw.js`.
SW містить pinned inventory/releaseId, staging cache per attempt + complete
marker last; HTTP status/MIME/format/size/SHA checks; failed cache не служить,
старий complete release і чужі caches не чіпаються. Routing §3.3, без HTML
fallback/SWR/forced activation/reload. STATUS diagnostic protocol не є UI.
Actual development build і source HTML виключають registration/SW.

Runnable повний eval: `node debug/pwa-phase4-eval.js` з кореня checkout.
Нові `pwa-worker-test.js`, `pwa-worker-browser-test.js`, `pwa-phase4-eval.js`;
package scripts і Makefile tiers. Old no-production-SW assertions замінено
production identity/source-dev exclusion/isolated fixture/byte-preservation,
не послаблено inventory/assets/shader guards.

Історичний final eval реалізації 2026-10-14: build PASS; guards worker **10/0**, release **4/0**,
assets **7/0**, harness **5/0**, shader **25/0**, demo **8/0**, palette **6/0**;
control API PASS без assertion enumeration. Production browser **10/0**,
retained asset browser **2 viewport**, release browser **2 WebGL**, disposable
harness **8/0**. Не підсумовувати різні suites/рівні. Chromium 153.0.8010.12,
Node 24.19.0, SwiftShader. П'ять production persistent browser processes
повністю закрито/disconnected, три cold offline navigations після close.
Offline WebGL1/2 draw/resize/Bake/PNG export/local PNG/story import+playback
PASS; Bake rendered delta=0, wet=0, GL/page errors=0. Completed playback —
12-tile subset retained story: 14/14 operations, pending=0; повний великий
JSON імпортований, але full playback до кінця NOT TESTED.

Два actual failed upgrades: required JS TCP cut після попередніх install fetches
і HTTP404; redundant/waiting=false, CacheStorage лишився byte-identical V1,
partial cache відсутній, old app online/offline і subsequent browser restart
працюють. Valid V2 потім verified/waiting, V1 не reload; natural activation
після всіх clients close та offline V2 cold shell PASS. Query unchanged;
same-origin controlled embedded exact-origin handshake PASS, actual сторонній
origin/window не ready за deadline, стан app незмінний. Vendor untouched.

Evidence поза repo:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase4-final-5sYqN3/`.
Root `result.json`: exact commands/exit codes/suite counts/absolute artifacts;
`production-probe/result.json`: actual-worker cases, dist snapshots/profile,
CacheStorage bytes, PNG/HAR/traces, browser/server logs. Own servers stopped,
усі owned ports bind-back PASS окремим Node process; чужих не зупиняли.
Review stand не залишено. `git diff --check` PASS.
Повний report і manual steps — [PHASE4-REPORT.md](./PHASE4-REPORT.md), [QA.md](./QA.md).

**Новий інваріант фази 4:** partial/failed release ніколи не serve app shell;
exact-worker guards перевіряють кожну rejection reason, а actual production SW
network/404 probes доводять стару complete identity після offline restart.
Реєстрація source/dev заборонена; natural activation не є forced update.

NOT TESTED: actual browser quota exhaustion/MIME/hash/HTML fault injection
(covered Node guards); physical Android/iOS/native GPU/OS reboot, full великої
story playback, storage eviction, CDN/headers/CORS/demo downloads, full
`make verify`. Phases5–10 readiness/install/update UX, cap/retention/rollback
не реалізовано; acceptance фази 4 не є acceptance цих меж чи deploy permission.

Closing check 2026-10-15: production build PASS; свіжі guards worker **10/0**,
release **4/0**, assets **7/0**, harness **5/0** — окремі suites.
Збережені browser results PASS/exitCode=0 повторно прочитано: production
**10 cases**, assets **2 viewport**, release **2 WebGL**, fixture **8 cases**;
проби не перезапускались. Port 3000 bind-back PASS. NOT TESTED збережено.

## Фаза 3 — прийнята й закрита

Нижче — історичний eval фази 3. Її no-production-SW межа superseded фазою 4; поточний fixture guard перевіряє ізоляцію та незмінність production SW bytes.

Прийнято власником через `handoff:next` 2026-10-14; deploy не виконано. Нові `debug/pwa-sw-harness.js`,
`pwa-sw-fixture.js`, `pwa-sw-selftest.js`, `pwa-sw-harness-test.js` і три
package scripts. Production app/engine/Gulp/Netlify не змінено, `dist/sw.js`
відсутній. API, commands та exact artifacts — [PHASE3-REPORT.md](./PHASE3-REPORT.md).

Disposable `/sw.js` існує тільки як overlay власного HTTP server, scope
`/__pwa_fixture/`; real install fetch кешує HTML і 29-byte server text.
Reusable persistent Playwright harness: всі tabs і browser закриваються;
новий процес запускає той самий profile, offline встановлено **до першого
navigation**. CacheStorage читається з browser із size/SHA-256; active/waiting
message protocol має UUID, unrelated-ID filter і bounded timeout. Waiting
стан очікується до `installed`, не registration/update success. Production-like
server читає незмінний prebuilt dist, MIME правильні, `/sw.js` і обидва metadata
no-store, HTML no-cache, immutable лише для full SHA-named assets, 404 без SPA fallback.

Історичний eval реалізації 2026-10-14, Node 24.19.0 / Chromium 153.0.8010.12:

- `npm run build`: PASS, exit 0.
- `npm run test:pwa-sw -- …`: Node guard **5 passed / 0 failed**;
  actual fixture browser selftest **8 cases PASS / 0 failed**.
- `npm run pwa:sw:review -- … --resume`: **8 cases PASS / 0 failed**;
  другий окремий Node process на тому самому profile/origin читає попередню
  v2 і exact cache snapshot до registration, не чистий profile.
- `npm run test:pwa-assets`: retained **7 passed / 0 failed**, no-production-SW
  guard не послаблено. Full `make verify` не запускався.
- У кожному browser invocation: 2 runs, 2 real offline cold starts,
  4 closed/disconnected persistent browser processes, 0 page errors;
  19 inventory HTTP/SHA/MIME/header readbacks і 3 metadata/SW no-store responses.
  Active v1/waiting v2 у першому; active v2/waiting v3 у другому. `IGNORE` timeout
  250ms → expected failure, фактично 260ms/266ms; наступний STATUS успішний.
  Natural activation після close; offline cached byte `fromServiceWorker=true`.
  Final cache snapshots: перший 2 caches/4 entries; другий 3/6 (fixture only).

Evidence **поза repo**:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-final-JSzEQD/`:
`result.json` має точні commands/exit codes і stdout/stderr logs; browser
`guard-selftest/result.json`, `probe-resume-review/result.json`; shared `profile/`;
`verified-summary.json`, `independent-bind-back.json`. У acceptance pair:
**8 real PNG, 8 traces, 8 HAR**, по 4 кожного на invocation; `server.json` і
`browser.json` у кожному. Обидва власні servers stopped, port=3000,
`portFree=true` після bind-back; незалежний bind-back також PASS. Review stand
не залишено, чужих процесів не зупиняли. QA-3A–3G виконано до review.

Незалежний parent rerun: guard **5/0**, first/resume browser **8/0 кожен**,
retained assets **7/0**; новий profile/origin port 62805, усі browser/server
cleanup та bind-back PASS. Evidence:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-parent-9JsNbW/`;
commands/results і visual inspection — [PHASE3-REPORT.md](./PHASE3-REPORT.md).
Це повторні suites, не додаткові унікальні tests.

Межі: production SW/app offline, readiness/install/update UX, partial install
negative matrix, cap/rollback, CDN/deploy, Android/iOS/standalone, OS reboot та
storage eviction — NOT TESTED / наступні фази. Fixture caches навмисно
збережені, це не production retention policy. Scratch timing race waiting-state
виправлено bounded polling; failed scratch runs не є acceptance.

**Новий інваріант фази 3:** second process/profile restart не може видавати
чистий профіль за persistent proof; offline cold navigation має SW response
після browser close, а protocol failure має deadline. Механізм/guard/probe —
`debug/pwa-sw-selftest.js`; static/server guard — `pwa-sw-harness-test.js`.

Closing check фази 3 (2026-10-14): production build PASS; harness guard **5/0**,
retained assets **7/0** — свіжі окремі suites. Browser first/resume **8/0 кожен**
вище — історичні, result.json повторно прочитано, без перезапуску проб.
Port 3000 незалежно bind-back PASS; межі NOT TESTED збережено.

## Фаза 2 — прийнята й закрита

Production finalizer `debug/pwa-release-build.js` виконується після всіх Gulp
streams: binary fonts/icons/favicon → SHA-256 names; JS → hash; CSS після
переписування font URLs → hash; manifest після icon URLs → hash; HTML після
всіх references. Імена мають **повний 64-hex content SHA-256** перед extension.
Source/dev лишаються з фіксованими paths. Production `startServer` не має
watchers: служить точний prebuilt dist, не переписує частину release.

`dist/precache-inventory.json`: `schemaVersion:1`, `releaseId`, encoding,
19 required entries (`path`, `sha256`, `size`): HTML, JS, CSS, manifest,
9 WOFF2, 5 app icons, favicon. `dist/release.json`: той самий releaseId,
diagnostic gitSha/buildTime і `assetMap` source→hashed output. Обидва JSON
виключені з identity; SW відсутній. Shader дерева лишаються compatibility
network-only output, не inventory. LICENSE/font license/upstream metadata
не є required shell; master і scratch `.build` прибрані з production dist.
Build чистить лише власний `dist`; тести stale output не видаляють нічого поза ним.

**Canonical encoding v1:** entries перетворюються на `[absolute ASCII URL path,
lowercase SHA-256]` pairs; lexicographic unsigned UTF-8 byte ordering за path;
`JSON.stringify(pairs)` → UTF-8, без BOM, пробілів і trailing newline.
Дозволені `/[A-Za-z0-9._/-]+` paths, без `//`, `.`/`..` сегментів, query,
backslash, Unicode чи duplicates; SHA рівно 64 lowercase hex. `releaseId` =
SHA-256 цих байтів. `size`, formatting inventory JSON, gitSha і buildTime
не входять. Canonical empty list golden digest і exact nonempty bytes,
reversed input, invalid paths/hash, path/content sensitivity — asserted tests.

### Історичний eval реалізації 2026-10-14 (Node 24.19.0, npm 11.17.0, Windows x64)

- **Build:** `npm run build` PASS; окремий logged production Gulp build PASS.
- **Guard:** `npm run test:pwa-release` / його exact Node equivalent:
  **4 passed / 0 failed** — два реальні production builds однакові, зміна
  HTML у isolated source fixture змінює identity, stale file/directory зникають,
  усі HTML/CSS/manifest references inventory-resolved, всі bytes/hashes/name
  digests перевірені. `test:pwa-assets`: **7/0**, `test:shader-bundle`: **25/0**.
  Shader negative-build fixture тепер копіює новий build helper, тому failure
  досі доводить shader contract, не випадковий missing require.
- **Probe:** `PWA_QA_PORT=3000 npm run test:pwa-release:browser`: **2 cases PASS**,
  реальний Chromium 153.0.8010.12 / SwiftShader, WebGL1 та WebGL2. Два реальні
  builds, кожен відкрито на одному origin; pointer draw, preview/commit resize
  180×130 → 196×142, viewport resize, UI Bake, справжній PNG download/import,
  retained story JSON import (`ready`). Bake rendered max delta = 0, wet material
  = 0, Undo/Redo false, GL/page errors = 0. PNG 196×142; кожен із 19 inventory
  URL HTTP 200 + byte SHA readback. Hashed 404 = 0, shader XHR = 0.
- **Phase-1 regression probe:** `PWA_QA_PORT=3000 npm run test:pwa-assets:browser`:
  **2 viewport PASS**, 9 faces loaded на кожному, MIME і manifest перевірені,
  0 Google requests/manifest/page errors/same-origin failures. Guard не послаблено:
  byte-for-byte provenance, icon sizes, font subsets/swap і no-SW збережені.
- **Full:** `make verify` не запускався; scope-specific guard+probe вище — не
  full-suite і не physical-device acceptance. Makefile реєструє PWA checks у
  fast/browser tiers; `docs/SDLC.md` описує production схему.

Release ID двох browser builds:
`064492d543fbcc5cfe53f48c23de5f44338dc998384f807e52b6376c25aec890`.
Evidence (абсолютні шляхи; не generated repo files):

- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase2-RREa45/result.json`
  — metadata, builds/cases/HTTP readback/cleanup; поруч HAR, trace, build/server
  logs, inventory/release snapshots, 14 справжніх PNG (12 screenshots + 2 exports).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791976458083-44816/result.json`
  — fresh phase-1 compatibility probe, HAR/trace/6 PNG.
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-guard-ONChpQ/result.json`
  — exact commands, environment/revision/dirty scope і окремі build/guard logs.
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-change-xYWmvD/result.json`
  — change-sensitive isolated source fixture + build.log; власний fixture dist
  видалено. Невдалий scratch `fluid-pwa-phase2-guard-SnQAyC` (неправильний
  npm-cli locator) не acceptance; повторено через справжні Node entrypoints.

Обидва власні Gulp servers завершені, port=3000, `portFree=true` після bind-back.
Перший probe на 52406 також завершився й підтвердив bind-back. Чужих процесів
не зупиняли. `dist` ignored, no generated evidence у repo. Власник прийняв фазу 2
командою `handoff:next` 2026-10-14. Обмеження: resize painting — existing debug preview/commit API,
не edge-pointer gesture; draw/Bake/export/import — реальний UI. Story playback,
offline/install/update, persistent SW harness, Android/iOS, CDN headers/deploy
не перевірені й лишаються майбутніми фазами. Physics/palette/vendor без правок.

**Новий інваріант фази 2:** кожен built HTML/CSS/manifest reference належить
inventory цього release; `releaseId` визначають тільки canonical paths+bytes.
Механізм — `debug/pwa-release-build.js`; guard — `debug/pwa-release-test.js`.

Closing check 2026-10-14: production build PASS; release guard **4/0**, assets
**7/0**, shader compatibility **25/0** — свіжі, окремі suites. Виконано через
прямі Node entrypoints після timeout npm shell invocation (той timeout не PASS).
Browser PASS/evidence вище повторно прочитано; проби не перезапускались, це
історичне покриття без змін production code після них. Межі NOT TESTED збережено.


## Головні виміряні факти

Історичний eval реалізації фази 1 на working tree `3e341fc` (2026-10-14):

- `python debug/generate-pwa-icons.py`: 5 іконок; foreground radius 272px ≤
  293.2px safe circle у 733px master. Source SHA-256 зафіксовано у provenance.
- `npm run build`: PASS, production dist зібрано; generated dist ignored.
- `npm run test:pwa-assets`: **7 passed / 0 failed**. HTML/CSS/manifest local
  references існують; identity, sizes, PNG/WOFF2 signatures, byte-preserving
  copy, static faces/swap/valid unicode ranges і відсутність SW перевірено.
- `PWA_QA_PORT=3000 npm run test:pwa-assets:browser`: **PASS на 2 viewport**
  (1280×900 і 320×900), Chromium 153.0.8010.12 / SwiftShader. 9 faces loaded
  на кожному; 0 Google font requests, 0 manifest parse errors, 0 page errors,
  0 failed same-origin assets. Слайдер клікнуто, File/Player/State переключено.
  На 320px main panel 296px (x=12), extension 304px (x=8); controls у viewport.
- Actual HTTP 200/MIME: webmanifest `application/manifest+json`, png `image/png`,
  svg `image/svg+xml`, woff2 `font/woff2`. Probe SVG видалено після запуску.
- Evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791974679450-60396/`
  (`result.json`, `network.har`, `trace.zip`, `server.log`, 6 PNG).
- Власні review servers зупинено; порти 53256 (перший successful probe) і 3000
  (остаточний probe) звільнені й перевірені bind-операцією; 3000 також повторно
  перевірено незалежною командою. `git diff --check`: PASS.


~~1. **Фаза 1 — локальні assets і нуль зовнішніх залежностей.**~~
   **ЗАКРИТО: прийнято власником 2026-10-14 (`handoff:next`).** Див.
   [QA.md](./QA.md) і історичні факти фази 1 вище. Історично після фази 1 наступною була фаза 2; тепер 1–2 закриті,
   тепер фаза 3 також закрита; фаза 4 також закрита, 5–10 не починались.
   Контракт: self-hosted Open Sans woff2 400/600/700 з `@font-face` у
   `app/layout.css`, Google Fonts посилання зняте з `index.html`; icon master
   (vector або ≥512px) і згенеровані з нього 192/512 maskable та apple touch;
   `manifest.webmanifest` зі стабільним `id`, явним `scope`, same-origin
   `start_url` без debug/embedded параметрів; dev server у `gulpfile.js`
   віддає `.webmanifest`/`.png`/`.svg` з правильним content type.
   Service worker у цій фазі ще не з'являється — застосунок лишається
   звичайною сторінкою.
   Guard: новий `node --test` на built output (нуль cross-origin посилань у
   HTML/CSS/manifest, повнота manifest, наявність усіх розмірів іконок,
   ваги 400/600/700 оголошені локально) плюс `npm run build`.
   Probe: відкрити зібраний `dist` у браузері на 320 px і на desktop —
   панель, слайдери та story controls не з'їхали, DevTools Network не має
   жодного запиту до fonts.googleapis.com/fonts.gstatic.com, Application →
   Manifest парситься без помилок і показує іконки.
   Новий інваріант: built output не має зовнішніх network-залежностей.

~~2. **Фаза 2 — release identity, hashed assets і precache inventory.**~~
   **ЗАКРИТО: прийнято власником 2026-10-14 (`handoff:next`).** Історичні
   eval/evidence вище; сценарії QA-2A–2G виконано до review.
   Контракт: build видає hash-named JS/CSS/font/icon assets, HTML посилається
   лише на assets свого release, `releaseId` = digest канонічного inventory
   (paths + SHA-256), git SHA і build time — діагностичні поля; SW-файл і
   metadata з `releaseId` виключені з self-referential hash; shader дерева в
   inventory не входять. SW ще немає.
   Guard: новий `node --test` на детермінізм hashing (два build — той самий
   `releaseId`), canonical ordering/encoding, відсутність shader шляхів в
   inventory, збіг кожного посилання в HTML з inventory; `npm run build`.
   Probe: зібрати двічі й відкрити `dist` у браузері — малювання, resize,
   Bake, PNG export і локальний імпорт працюють, у Network нема жодного 404
   на hashed шляхах.
   Новий інваріант: усі посилання built HTML належать inventory цього release.

~~3. **Фаза 3 — QA harness для service worker (spike).**~~
   **ЗАКРИТО: прийнято власником 2026-10-14 (`handoff:next`).** Історичні eval/evidence
   вище; [QA-3A–3G](./QA.md), [report](./PHASE3-REPORT.md).
   Контракт: браузерний harness у `debug/` із persistent Playwright profile
   і production-like serving (правильні content types, `no-store` для
   `/sw.js` і metadata), що вміє: зареєструвати **викидний** SW, закрити всі
   сторінки, запустити профіль знову, прочитати CacheStorage і active/waiting
   стан через message protocol з request ID і timeout, перемкнути offline.
   Справжній SW теми тут не пишеться — фаза доводить саму можливість
   перевірки, щоб фази 4–8 не застрягали на інфраструктурі.
   Guard: harness проходить власний self-test (persistent profile виживає
   перезапуск; victim SW контролює сторінку; offline navigation віддає
   закешований байт), `npm run build` лишається зеленим.
   Probe: запустити harness двічі поспіль на тому самому профілі — другий
   запуск бачить SW і кеш від першого, а не чистий профіль. Артефакти проби
   (trace, скріншоти) лишаються поза repo.
   Межа фази: якщо cold start із повним закриттям сторінок у harness
   недосяжний, це фіксується як обмеження до написання SW, а не під час.

~~4. **Фаза 4 — SW: install, перевірений precache, fetch routing.**~~
   **ЗАКРИТО: прийнято власником 2026-10-15 (`handoff:next`).**
   Історичний report/eval і свіжий closing check вище; deploy не виконано.
   Контракт: build-generated `/sw.js` зі стабільним URL і `releaseId`;
   install завантажує inventory у власний staging cache і перевіряє статус,
   тип/формат і hash кожного required asset; будь-який
   404/HTML-as-JS/MIME/hash mismatch/quota/network failure відхиляє install,
   стара версія лишається працездатною, partial cache не обслуговує; fetch
   routing за §3.3 (version-pinned shell для `/` та `/index.html` із
   незмінними query, cache-first лише для inventory цього release, інші
   same-origin шляхи network-only без HTML fallback, жодного SWR для app
   HTML/JS/CSS, `/sw.js` і metadata не з app cache, без POST/auth/довільного
   cross-origin, сторонній origin і embedded bridge не перехоплюються);
   реєстрація лише в bundled production mode.
   Guard: `node --test` на routing allowlist, partial-install refusal,
   source/dev registration exclusion, відмову за кожною причиною зі списку;
   `npm run build`.
   Probe (через harness фази 3): online install → offline → закрити всі
   сторінки → cold start → малювання, resize, Bake, PNG export, локальний
   імпорт PNG/story і playback; потім network cut mid-install і required
   asset 404 — стара версія далі працює.
   Acceptance фази = acceptance §8A спеки.

~~5. **Фаза 5 — readiness і install UX.**~~
   **ЗАКРИТО: прийнято власником 2026-10-15 (`handoff:next`).**
   Поточний eval/контракт: [PHASE5-REPORT.md](./PHASE5-REPORT.md),
   [QA-5A–5I](./QA.md). Далі фаза 6 після окремого дозволу.
   Контракт: стани offline unavailable / preparing / offline ready, де
   «Готово до роботи offline» показується лише після завершеного precache,
   active worker і підтвердженої version/readiness — не після registration
   success і не для першого uncontrolled page; чесне повідомлення, що
   offline restart не відновлює попередній малюнок, показане **до**
   reload/update; порожній профіль не оголошує себе готовим; storage wipe
   пояснюється; install prompt має graceful fallback, на iOS — інструкція
   Add to Home Screen без фальшивої автоматичної установки.
   Guard: `node --test` на машину станів readiness (registration success не
   дає ready; uncontrolled page не дає ready; wipe переводить у unavailable).
   Probe: на свіжому профілі пройти шлях від першого відкриття до «Готово до
   роботи offline», потім стерти site data і перезавантажити — застосунок
   чесно повідомляє втрату, а не показує готовність; на iOS-пристрої (або
   мобільному Safari preview) видно інструкцію A2HS, не кнопку установки.

~~6. **Фаза 6 — headers і detection state machine.**~~
   **ЗАКРИТО: прийнято власником 2026-10-15 (`handoff:next`).**
   Свіжий final eval і hosting exact-path уточнення — [PHASE6-REPORT.md](./PHASE6-REPORT.md).
   [QA-6A–6H](./QA.md); далі фаза 7 після окремого дозволу.
   Контракт: нова секція `[[headers]]` у `netlify.toml` (`no-store` для
   `/sw.js` і metadata, `no-cache` для app HTML, `immutable` лише для hashed
   шляхів нової схеми); реєстрація з `updateViaCache: 'none'`; обробка
   `updatefound`, `statechange`, наявного `registration.waiting`,
   `controllerchange`, failed/redundant install; message protocol з request
   ID і timeout; перевірки при запуску, foreground return, online event,
   ручній команді та кожні 15 хвилин видимого застосунку з throttle 1/хв,
   coalesce concurrent calls, скиданням таймера після кожної фактичної
   перевірки й зупинкою при прихованому документі; UI показує active
   version, waiting version і результат останньої перевірки; progress
   indeterminate без byte instrumentation; offline failure не тлумачиться
   як «нової версії немає».
   Guard: `node --test` на state machine (включно з existing waiting worker
   до UI bootstrap, failed worker, повторними events), на визначення headers
   і на те, що immutable rule не матчить фіксовані імена; `npm run build`.
   Probe (harness): V1 і V2 на одному origin у production-like serving —
   waiting worker виявлено, «Пізніше» лишає V1 повністю робочою, V2 готова;
   старі й нові assets не змішуються.

~~7. **Фаза 7 — безпечна активація і захист роботи.**~~
   **ЗАКРИТО: прийнято власником 2026-10-15 (`handoff:next`) із обов’язковою 7A.**
   [PHASE7-REPORT.md](./PHASE7-REPORT.md), [QA-7A–7M](./QA.md). UX-зауваження
   винесено в 7A перед фазою 8; implementation 7A потребує окремого дозволу.
   Нижче збережений acceptance контракт.
   Контракт: дії «Перевірити оновлення» / «Оновити» / «Пізніше»; ні
   автоматичного reload, ні unconditional `skipWaiting()`/`clients.claim()`;
   до activation завершується мазок, не перериваються import/export/Bake й
   story playback; dirty state визначається через production API, а при
   неповному визначенні стан вважається потенційно незбереженим; PNG export
   як збереження з окремим підтвердженням користувача (completion API не
   доказ запису файлу) плюс явне «Оновити без збереження» з описом втрати
   wet state/history; multi-tab як notification, а не lock —
   unresponsive/suspended clients активацію не блокують, завжди доступна
   явна дія «Оновити все одно»; після allow — `skipWaiting`, після
   `controllerchange` один reload лише тією сторінкою, що його очікує,
   з one-shot marker у `sessionStorage` цієї вкладки; reload перевіряє
   отриманий `releaseId`; природна активація браузером після закриття всіх
   clients дає новий shell без prompt.
   Guard: `node --test` на once-only activation/reload, дедуплікацію events,
   область marker (`sessionStorage`, не `localStorage`) і на те, що
   unresponsive client не блокує activation.
   Probe (harness + руками): дві вкладки, у першій dirty canvas і активний
   мазок/playback/export — «Оновити» не губить роботу; друга вкладка не
   reload без згоди; нова вкладка, відкрита під час activation, працює на
   старих hash assets; suspended вкладка не блокує «Оновити все одно»;
   жодного reload loop.


<!-- Кінець точних історичних блоків. -->

# Handoff: Fluid PWA — offline shell та надійні оновлення

## Закриття фази 8 та floating update UI — 2026-10-16

Власник прийняв фазу через `handoff:next` і прямо авторизував production deploy.
Фаза 8 закрита; наступний функціональний scope — фаза 9 (offline demos), ще не розпочата.
Production deploy та HTTPS readback PASS; результат у [PRODUCTION-2026-10-16.md](./PRODUCTION-2026-10-16.md).

- Cleanup + дві вкладки: свіжий guard **78 executions / 0 failed** (з imported cases),
  browser **9 cases / 0 failed**, 2 builds; `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase8-IuPmPV/result.json`.
  Старий runner припускав, що isolated review3000 дорівнює shared dist: перша closing спроба
  `fluid-pwa-phase8-fJVM2y` відхилена; тепер dist та review HTTP перевіряються незалежно до/після.
- UI: 44×44 icon, 8px від лівого/нижнього краю з safe-area (як debug; Android desktop-site 2.05vw).
  Fixed popover 320px, на 320px viewport — 304px; full-height canvas без footer/ResizeObserver.
  Opacity як bug: background .55 / foreground .85 / border .35. Enter/Escape та outside-click close.
- Save PNG — лише installed verified waiting update + idle painter із реальним artwork;
  у спільному рядку actions, без Credits link. Automatic PNG перед explicit Update збережено.
  Standalone `pwa-credits.html` та ліцензійні attribution лишено в artifact.
- Browser: повна висота app не змінюється при відкритті; desktop/320/short landscape;
  no-update/empty-with-update hides Save, real pointer artwork + ready update shows Save,
  PNG download працює. Screenshots: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-review-cz1ysO`.
- Canonical release gate із Makefile виконується Node-оркестратором (GNU Make відсутній);
  **PASS: 25 test commands + final build = 26 commands exit0**; evidence `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-prod-gate-0nOUKk/result.json`.
  Старі assertions timestamp-equality/footer/manual-consent приведено до прийнятого контракту;
  негативні install/encoder/busy gates, PNG-before-navigation, once-only reload та старі assets збережено.

Production deploy `6ad2774957cb01560c91ebe8`, revision `69cd448`, release `b7606642d683c177e164202aa80b8a83b4dafa2b336675f7fe6e5b04e4d83cb4`.
HTTPS24 paths/SHA/headers PASS; browser6 cases incl. cold offline restart/draw PASS.
Local review PID51008 stopped,3000 bind-back PASS; наступний QA URL — production.

Збережені межі: physical Android/iOS/Safari/native GPU/install/OS reboot не перевірені;
quota/locks failures — deterministic guards; unknown/legacy clients і unobserved reserved pins
консервативно утримують cache. Offline demos/CORS не є acceptance. Нижчі checkpoints історичні.

## Історичний checkpoint фази 8 — до acceptance

Дозвіл «Роби змінену фазу 8» авторизував реалізацію cleanup + дві вкладки.
**Далі: human review [QA-8](./QA.md#фаза-8--cleanup--дві-вкладки-review),
[PHASE8-REPORT.md](./PHASE8-REPORT.md); не нова реалізація фази 8/9.**
Commit/deploy/оновлення retained dist не виконано. 7A лишається прийнятою.

Свіжі guards: cleanup15/0, worker12/0, activation11/0, autosave9/0,
detection16/0, readiness11/0, UX4/0; combined78 executions не є unique total.
Isolated browser PASS/9 cases: failed V2 install зберігає V1/artwork;
auto-PNG перед одним own reload; frozen/nonconsenting вкладка не reload;
18 old hashed assets SHA-exact offline (унікальний V1 bundle); остання стара
вкладка закрилась → STATUS прибрав V1; user/demo/foreign data unchanged;
V2 offline reload/draw PASS. Evidence `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase8-bWky0A`.
Own browser closed, port58194 bind-back PASS. Retained3000 ECONNREFUSED до/після,
усі54 dist файли та3 unrelated files SHA-unchanged до baseline, сервер не чіпали.

**Обмеження cleanup:** без Web Locks не збираємо; unknown/legacy clients
утримують кеш до закриття; pending reserved navigation без жодного live
спостереження може відтермінувати cleanup назавжди (не протухає за таймером).
Aborted navigation/crash та physical/Safari/legacy-worker upgrade не browser PASS.
Це не архів версій як функція і не повернення cap/rollback requirement.
Нижчі «дозволу ще немає/cleanup немає» — попередні checkpoints, superseded
цим статусом; історичні вимірювання та безпека відкритих вкладок збережені.

## Рішення власника — заміна scope 8

Історія версій у браузері, cap у три releases, штучна quota refusal за їхньою
кількістю та локальна rollback-підсистема скасовані, не відкладені як борг.
Замість попередньої фази 8 — вузьке завершення updates: cleanup непотрібного
app cache та безпека другої вкладки. Канонічний контракт —
[PWA-OFFLINE-UPDATE-SPEC.md §4.1](./PWA-OFFLINE-UPDATE-SPEC.md#41-життєвий-цикл-update-та-прибирання-кешу).
7A лишається прийнятою. Рішення про заміну scope спочатку дозволяло лише
документацію; наступна команда «Роби змінену фазу 8» дозволила реалізацію.
Commit і deploy не авторизовані. Старі звіти/архіви з retention/cap/rollback
описують історичний план, а не чинний requirement. Безпека живих вкладок чинна.

## Поточний локальний review — minimal status + automatic PNG

**Supersedes the icon-only UI/consent contract below; prior measurements remain historical.**
**Прийнято власником через `handoff:next` 2026-10-15; фазу 7A закрито.** Closing commit авторизований цією командою; нового external deploy немає. Незакриті technical/physical/legacy обмеження нижче збережені.

- Live: http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41 . Same freshly checked node.exe **PID31212**, parent70768; no listener restart.
- Release `2195ab1b3a1e1a35d8201df0daa1c1b1d52dd77bb50a6b525f8845f446255e69`; build metadata **2026-10-15T18:49:32.443Z**, visible **2026-10-15 18:49** (UTC minute, not runtime clock/hash). Full hashes remain internal. Snapshot build has `gitSha:null` (no Git metadata in copied source); source SHA comparison is recorded separately, not invented revision metadata.
- Visible information: Active version and Last check / No update found. Verbose preparation, backup, shell hash, verified-update and install instructions removed. Real licensed SVGs retained; minimal Credits link opens distributed/offline-cached `pwa-credits.html` with Dazzle UI / SVG Repo / CC BY4.0 attribution.
- Save PNG invokes actual painter export. Explicit Update on the **new code** checks real pigment readback / baked-or-imported background (dirty remains unknown), automatically downloads nonempty artwork, then rechecks busy/candidate identity before ALLOW. Empty canvas does not download. Encoder/readback/candidate/storage failures fail closed. No repeated file-check/discard dialog. PNG remains flattened, not wet-paint/Undo persistence; browser download initiation cannot prove the user's final disk destination.
- Evidence `$A = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-autosave-x4ZnZf`: `result.json` **PASS_WITH_LEGACY_LIMITATION**. Two isolated production builds; affected **54 tests passed / 0 failed** (`unit.log`, repeated current-checkout `final-unit.log`). Actual browser proves pointer PNG before one reload, encoder failure preserving old active/artwork/waiting with no download/reload, empty update with zero downloads, menu PNG, desktop/320 minimal UI, exact HTTP/cache inventory and retained old immutable URLs. Not a full make verify or physical-device rerun.
- Auto PNG `auto-update-pointer-artwork.png`: **180x130, 23159 bytes**, SHA `b942d80cb3ae21fe7a4bfdb4a62f3e4e5ff34a2ffe7b2aa96cdea195cee59e5f`, decoded **8230 colored pixels**. Menu PNG: **180x130, 20856 bytes**, decoded **8750 colored pixels**. Not blank/synthetic exports.
- **Legacy limitation, not automatic-save PASS:** real persistent/restarted `ca3c9da7…` localhost client existed before publication, retained pointer artwork/document while `registration.update()` fetched exact new complete waiting release. Its already-loaded immutable JS necessarily kept its old Export PNG + separate confirmation path. That real PNG was exported and decoded before one explicit consenting reload to the new version. No old bundle rewrite, script injection, forced activation or user data clearing. New one-click auto-save applies after this first upgrade; retroactive auto-save in the old document is not claimed.
- Screenshots: `$A/new-ui-desktop.png`, `new-ui-320.png`, `legacy-ca3-waiting.png`; valid PNGs, HAR/traces, `cache-snapshot.json`, frozen `source/`, `v2/`, `old-dist-backup/` retained. Owned test browsers closed; own test ports bind-back verified; retained3000 remains running.
- Intermediate failures retained: `fluid-pwa-autosave-gFfxmx` pointer setup while expanded dock; `4YxzbB` old inventory guard assumed every non-index entry immutable (fixed for separate fixed credits HTML). Main `$A` hit one No-update wait timeout after successful save/failure/empty probes; fresh persistent-profile check and bounded `resume.cjs` completed UI/publish/legacy/cache verification. Original failure is retained in `previousRunnerError`; not relabelled a clean uninterrupted run.
- Full details and exact source list: [AUTOSAVE-REVISION.md](./AUTOSAVE-REVISION.md). Physical/native/Safari/CORS debt unchanged. **Scope8 реалізований, далі human review QA-8; старий retention/cap/rollback scope скасовано.**
- Closing guard: шість unit entrypoints activation/detection/readiness/worker/UX/autosave — **63 executions passed / 0 failed**; autosave imports activation cases, тому це не 63 унікальні assertions. Попередній browser probe `$A/result.json` **PASS_WITH_LEGACY_LIMITATION** збережено без перепублікації; historical broad consent suites не заявлені як current PASS. Closing readback PASS:8 production/build source SHA-identical до tested snapshot;20 exact inventory HTTP entries +3 SW/release/inventory metadata SHA-exact; auto/menu PNG SHA-exact до browser artifacts. Retained release2195ab1b… не перебудовували. Сторонні вже наявні зміни `debug/pwa-worker-browser-test.js`, `debug/shader-bundle-gpu-test.js`, `docs/spec/fluid-pwa/PHASE7-REPORT.md` лишено поза closing commits. Acceptance не означає physical/full-suite PASS.

## Історичний стан до owner acceptance 7A


Стан на 2026-10-15. Фази 1–7 прийняті власником і закриті. **7A реалізована й перевірена, передана на review; НЕ прийнята власником.** Дозвіл на реалізацію — відповідь власника `7a`. Commit/production не виконано. За «Зроби деплой» опубліковано draft: актуальний URL/evidence у [PHASE7A-REPORT.md](./PHASE7A-REPORT.md#draft-preview-7a--2026-10-15). Canonical full verify equivalent PASS (26 commands); live assets/cache headers PASS, online UI/draw PASS, **HTTPS offline readiness/reload/cold browser restart drawing PASS** на corrected draft `6ad0c2e352ccd54a95955f40`. Scoped exact generated manifest MIME fix входить у deploy authorization; strict worker незмінний. Попередній MIME FAIL збережено як історію у report. Нижчі no-preview/full-verify/CDN-NOT-TESTED записи — історія попереднього eval; physical/CORS борг лишається.

> **Архів:** фази 1–7 перенесено в [_archive/HANDOFF-phases-1-7.md](_archive/HANDOFF-phases-1-7.md) (2026-10-15); [парні регресійні QA](_archive/QA-phases-1-7.md).

Поточний контракт: release identity/hashed inventory → atomic verified SW install → pinned-shell readiness → detection → explicit safe activation. Compatibility old SHA assets збережено; cleanup реалізовано у фазі8, очікує human review. Cap і локальний rollback скасовані як вимоги, не є боргом. Реалізація й історичні вимірювання: [phase 7 report](./PHASE7-REPORT.md) та архів. No-SW/no-phase7 твердження ранніх фаз — лише історія, не чинні обмеження.

## Historical owner review 7A — icon-only revision

**Новий live review:** http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41 . Release `ca3c9da7eb4d622d0b7ee3f58d012a23384a79d8495758852b6a813857285148`; fresh exact PID31212/parent70768 незмінний. Власник явно дозволив SVG Repo icons + оновлення localhost. [Поточний report](./PHASE7A-REPORT.md#svg-repo-icons--оновлений-localhost--поточний-review) supersedes нижчі retained-dist-unchanged/старий UI snapshots; external preview `6ad0c2e352ccd54a95955f40` лишився historical glyph-version, нового deploy немає.

- **UX-7A-ICONS — IMPLEMENTED, PENDING OWNER ACCEPTANCE:** 9 actual Dazzle Line SVG Repo icons (Dazzle UI / CC BY4.0), inert generated geometry, consistent 22px/2px/24-viewBox, 44px controls, SVG status/details/disclosures; names/English/keyboard/live text збережено. Exact sources/license/adaptations: [provenance](../../../assets/pwa-ui/README.md), [SHA manifest](../../../assets/pwa-ui/sources.json). Не acceptance 7A.
- **REVIEW-LOCAL-STALE — FIXED, VERIFIED:** old `4e6ce90e…` served artifact замінено verified isolated V1 icon build, old immutable hashes retained; no server restart/user cache clear/forced claim/reload. 183 source SHA checks перед publish;19 inventory+SW/release/inventory (22 HTTP paths) exact. Actual localhost persistent old V1 client із real pointer artwork → `registration.update()` `/sw.js`, updateViaCache none → exact new complete waiting release; Cancel зберіг V1/artwork, explicit consent лише own test-artwork reload1, nonconsenting tab retained. `$L/result.json` PASS у `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-local-icons-mGPEXY`.
- Fresh final `$E = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-eanPOO/result.json`:13 commands exit0. Guards activation12/0, detection16/0, readiness11/0, worker12/0, UX5/0; browser production10/0, readiness13/0, detection7/0, actual V1/V2 activation14/0. Desktop/320 SVG screenshots/probes; own5 ports bind-back PASS. Worker/Paint safety factories незмінні; physical/native/Safari/CORS/phase8 debt не закрито. Нижчі старі counts — historical.


## Чинні передумови 7A та збережений борг

- `getUpdateSafety()` dirty remains unknown; busy stroke/import/export/Bake/playback blocks Update. Current revision auto-downloads real nonempty canvas before ALLOW; no manual-backup/discard workflow on new code. One-time legacy-document limitation is recorded above.
- CLIENTS includeUncontrolled та BroadcastChannel — notification, не lock. ALLOW прив’язаний до same-scope WindowClient/exact complete release; no claim/unconditional skipWaiting. Лише requesting page робить один reload після controllerchange з one-shot sessionStorage marker та pinned shell/release verification.
- Partial/failed install не служить shell; cache readiness потребує actual controller/complete/pinned identity. Fonts/icons/shell локальні. Build identity залежить лише від canonical inventory paths+SHA; подробиці encoding — у [архіві](_archive/HANDOFF-phases-1-7.md).
- Історичні PASS не перетворюють physical/CDN/CORS/full-verify та cleanup-readback limitation на перевірене покриття. Нижчий closing check — історичний запис, сервер/PID зараз не перевіряли.

| Що | Де | Репозиторій |
| --- | --- | --- |
| Спека | `docs/spec/fluid-pwa/PWA-OFFLINE-UPDATE-SPEC.md` | Fluid Paint |
| Цей handoff і майбутній QA | `docs/spec/fluid-pwa/` | Fluid Paint |
| Build, HTML, стилі | `gulpfile.js`, `index.html`, `app/layout.css`, `package.json`, `Makefile` | Fluid Paint |
| Hosting і headers | `netlify.toml` | Fluid Paint → Netlify |
| Новий PWA/update код | `app/` (controller), build-generated SW/manifest/inventory | Fluid Paint |
| Тести й браузерні проби | `debug/` | Fluid Paint |
| Demo catalog (scope C) | `app/story-demo-catalog.js`, bucket `stories` `/fluid-demo/` | Fluid Paint + зовнішній R2/CDN |
| Процедури релізу | `docs/SDLC.md`, `DEPLOY.md` | Fluid Paint |

`INVARIANTS.md` у цьому репозиторії немає; guard кожної фази — конкретні
скрипти `package.json`, як у темі `fluid-2`. Engine physics, палітри та
vendored Tilecraft transport/model/bridge ця тема не чіпає.

Два рішення щодо порядку, ухвалені власником 2026-10-14 при фазуванні:
harness для service worker — окрема spike-фаза **перед** SW (фаза 3), а
hashed assets і release identity йдуть **до** SW (фаза 2), щоб перший же SW
мав чесну identity й atomic install і не переписувався потім.

> **Далі: фаза9 лише за окремою командою. Production 2026-10-16 опублікований і перевірений; див. PRODUCTION-2026-10-16.md.**
> Фазу 7 прийнято власником через `handoff:next` 2026-10-15 і закрито із
> зауваженням щодо UX; closing commit поверх `5d900c1`. Фази 1–7 прийняті.
> [QA-7A–7M](./QA.md), [PHASE7-REPORT.md](./PHASE7-REPORT.md).
> 7A прийнята; чинний minimal-status/auto-PNG контракт та legacy limitation — [AUTOSAVE-REVISION.md](./AUTOSAVE-REVISION.md). Historical reports/evidence не стирали.
> Передумова acceptance 7A виконана. Scope8 реалізовано за окремою командою; owner acceptance ще немає.
> Draft preview опубліковано, online/offline review доступний; corrected draft і historical MIME failure у report. Production deploy не виконано; scope8 передано на review, фази9–10 не починались.
> Нижчі no-phase7 твердження попередніх фаз — історія, superseded цією фазою.

Нові інваріанти: counter тримає real encoder до Promise completion; ALLOW ACK
не запускає ранній STATUS до old controller; consented session marker дає лише
один own reload; frozen/uncontrolled clients не hard-lock і old hashes лишаються.
Guards — pwa-activation-test.js / actual worker-test; probe — activation-browser.

NOT TESTED: physical Android/iOS/Safari/A2HS/standalone, native GPU/OS reboot,
real mobile suspension/native install dialog/15-minute wall-clock, browser quota/
eviction/MIME/hash injection, full large-story playback, live Netlify/CDN headers,
CORS/demo downloads, full make verify. Physics/palette/vendor незмінні.
Scope8 реалізований, див. поточний report; фази9–10 не реалізовані. **7A закрито; далі human review QA-8.**

## Review 7A — свіжа перевірка 2026-10-15

Production changes: `app/pwa-register.js`, `app/layout.css`; без physics/palette/vendor/SW protocol changes.
Один runnable runner з root, без перезапису retained dist: `node debug/pwa-phase7a-eval.js`.
13 top-level commands exit 0 (не сума tests); exact args/env/cwd/logs — evidence/result.json.
Actual Chromium 153.0.8010.12/SwiftShader, не physical mobile. Native install dialog
не пропонувався; fallback і iOS-UA інструкція перевірені, не Safari acceptance.
Новий dock резервує висоту; expanded details може займати до 45dvh content зі
scroll, не перекриваючи canvas. Existing mobile Story tools overlap між власними
панелями не перероблявся; PWA dock їхні tabs не перекриває.
Повний результат, невдала проміжна probe й точні screenshot paths — [report 7A](./PHASE7A-REPORT.md).

## Історичний closing check фази 7 — 2026-10-15

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

## Що зроблено і працює

Прийнята реалізація фази 1 (closing commit):

| Файл | Стан |
| --- | --- |
| `index.html` | Google Fonts знято; manifest, theme-color, apple touch; favicon sizes виправлено на 64. Footer attribution лишився текстом без зовнішніх anchors. |
| `app/layout.css` | 9 self-hosted normal Open Sans faces: Latin/Latin-ext/Cyrillic × 400/600/700; swap, чинний fallback stack. Layout rules не змінено. |
| `assets/fonts/open-sans/` | 9 справжніх WOFF2, verbatim SIL OFL 1.1 LICENSE та upstream metadata. |
| `assets/icons/`, `debug/generate-pwa-icons.py` | Retained 733px master, 192/512 any і maskable, 180 apple touch; opaque background і safe circle; відтворюваний Pillow recipe. |
| `assets/PROVENANCE.md` | Owner-directed icon source/hash, pinned Fontsource 5.3.0 archive/integrity, attribution, recipe. |
| `manifest.webmanifest` | Fluid Paint, stable id `/`, explicit scope `/`, clean start_url `/`, standalone, colors, explicit any/maskable entries; без Android related apps. |
| `gulpfile.js` | Binary-safe static copy зі збереженням paths; static watcher; MIME webmanifest/png/svg/woff2; `startServer` task для точного prebuilt dist. |
| `debug/pwa-assets-test.js`, `package.json` | `npm run test:pwa-assets`: built-output guard. |
| `debug/pwa-assets-browser-test.js`, `package.json` | `npm run test:pwa-assets:browser`: real Chromium + production dist + gulp MIME; унікальні external evidence, cleanup і port bind proof. |
| `docs/spec/fluid-pwa/QA.md` | Виконувані українські кроки review, 8 сценаріїв, факти й чесні межі. |

Історичний стан до реалізації (перевірено 2026-10-14 на `55ed4a4`;
нижня таблиця — baseline, не поточний стан):

| Файл | Стан |
| --- | --- |
| `gulpfile.js` | Збирає `dist/index.html`, `dist/bundle.js`, `dist/app/layout.css`; копіює 24 shader файли та `LICENSE`/`favicon-64x64.png`. Імена фіксовані, hashing відсутній. Dev server без content type для `.webmanifest`/`.png`/`.svg`. |
| `index.html` | Рядок 10 тягне Google Fonts Open Sans 300/400/600/700/800; є лише `favicon-64x64.png`, немає manifest і apple tags. |
| `app/layout.css` | `font-family: 'Open Sans', Helvetica, sans-serif`; реально вживані ваги 400/600/700. |
| `netlify.toml` | Лише build/publish/NODE_VERSION. Секції `[[headers]]` немає; production віддає `bundle.js` з `Cache-Control: public,max-age=0,must-revalidate`. |
| `app/story-demo-catalog.js` | Валідований index/story з CDN і r2.dev fallback. Обидва origin віддають `Access-Control-Allow-Origin` з конкретним production origin, не `*`. |
| `debug/` | Жоден probe не використовує persistent browser profile; SW/CacheStorage ніде не тестується. |
| production bundle | Містить GLSL registry, shader XHR = 0. |


**Новий інваріант фази 1:** built HTML/CSS/manifest не має зовнішніх network
references; fonts/icons/shell self-hosted. Guard — `debug/pwa-assets-test.js`.
Це не заборона optional runtime Demo data: відкриття + дало 2 запити до CDN
index; demo/CORS/playback не є acceptance фази 1. SW/offline/install/update,
фізичні Android/iOS та production headers/deploy — NOT TESTED / майбутні фази.
Ширина 320px — Chromium viewport, не фізичний телефон. Mobile extension
накладається на основну панель за чинним layout; opacity/UX не змінено.
Жодного engine/palette/vendored коду не змінено. Власник прийняв фазу 1
командою `handoff:next`; перелічені NOT TESTED межі збережені.
Closing check 2026-10-14: `npm run build` PASS, `npm run test:pwa-assets`
7 passed / 0 failed. Browser evidence вище збережено без повторного запуску.

## НЕЗАКРИТЕ — почни звідси


~~7A. **Компактний icon-first PWA UX, SVG Repo icons, minimal status та automatic PNG.**~~ — ЗАКРИТО через `handoff:next` 2026-10-15.
   Поточний контракт та closing результати — на початку цього handoff; наступні bullets — збережена історія первинного UX eval, manual-confirmation flow superseded auto-PNG.
   Авторизовано відповіддю `7a`; не owner acceptance і не дозвіл на commit/deploy.
   - [x] Compact dock: collapsed **49px** на 1000×900 та 320×900, короткі статуси,
     icon actions із English title/accessible name; long IDs/timestamps — `Details & install`.
   - [x] Перевірено app/index/package: локалізаційного framework/catalogs не знайдено;
     PWA English-only, без нового localization шару.
   - [x] Native keyboard Enter, Escape, visible focus, live status/error; жодного
     color-only статусу. Measured dock height резервується поза canvas та File/Player/State.
   - [x] English artwork/wet paint/Undo loss; flattened PNG не backup; окремі
     export → перевірка файлу → confirmation; explicit discard/cancel. Safety factory
     та worker gates не змінено (лише copy/focus/render/layout).
   - [x] Fresh isolated build PASS; guards activation **12/0**, detection **15/0**,
     readiness **11/0**, worker **12/0**, UX **4/0**. Browser: production **10/0**,
     readiness **13/0**, detection **7/0**, actual V1/V2 activation **14/0**;
     desktop/320 keyboard/details/consent/error/install screenshots та geometry у report.
   - [x] Нові runnable `QA-7AUX-*`; старий `QA-7A` — історичний ID фази 7.
   - [x] Owner review / acceptance 7A через `handoff:next`; phase8 потребує окремого дозволу.
   Evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-azLg6U/result.json`.
   Retained `127.0.0.1:3000` PID31212 збережено; served inventory/SW byte-exact
   до/після eval, root dist не будували. Own 5 ports bind-back PASS; деталі в report.
   Physical/CDN/CORS/full-verify та historical cleanup-readback debt збережено.

~~8. **Вузьке завершення updates — cleanup + дві вкладки (заміна старої фази 8).**~~ — ЗАКРИТО через `handoff:next` 2026-10-16.
   **7A та scope8 прийняті. Closing eval і UI-контракт — на початку; PHASE8-REPORT.md.**
   - [x] До explicit Update поточна версія працює; нова готується окремо.
     Невдалий install, також реальна storage quota error, не псує поточну
     версію і не дає ready. Не вводити cap чи новий quota-framework.
   - [x] Після Update — чинний auto-PNG/safety/once-only reload контракт 7A;
     cleanup непотрібних app caches лише у власному namespace. Active/waiting,
     user data, downloaded demos та чужі caches не видаляються.
   - [x] Друга відкрита вкладка з малюнком не reload примусово й працює зі
     своїми старими assets. Зберігання лише для живих документів, не «про запас».
     Suspended/uncontrolled та new-tab activation race не скасовують safety;
     мовчання/таймаут не є доказом відсутності клієнта і не блокує Update.
   - [x] Після закриття останнього observed старого клієнта непотрібний кеш прибирається
     на наступній lifecycle-нагоді; не залишати його як історію версій.
   Guard: `node --test debug/pwa-cleanup-test.js debug/pwa-worker-test.js`;
   cleanup15/0 та worker12/0. Activation/autosave/detection/readiness/UX — у report.
   Probe: два real builds V1/V2 на одному isolated origin: успішний Update;
   невдале завантаження; друга вкладка з реальним малюнком до/після переходу;
   cache/asset readback до і після закриття останньої старої вкладки.
   Probe: `node debug/pwa-phase8-browser-test.js` PASS/9 cases, evidence у report.
   Для normal observed clients cleanup PASS; aborted/unobserved reserved pin
   може лишитися назавжди, без Web Locks cleanup вимкнений — retained limitations.
   Не запускати publish-capable legacy autosave runner; retained dist/server не змінювати.
   Виключено: cap у три releases, локальний archive/selector/rollback subsystem.
   Операційне повернення коду — звичайна повторна публікація, не окремий gate.

9. **Фаза 9 — offline demos (scope C).**
   Контракт: UI «Зберегти offline», downloaded list з availability/size і
   delete; зберігаються лише validated index/story з reuse чинних
   size/slug/schema checks; opaque cross-origin не трактується як verified
   JSON; записи в IndexedDB мають власний `schemaVersion`, source URL/slug,
   `fetchedAt`, content hash і validated payload; збереження однієї story
   атомарне в IDB transaction; online catalog і downloaded list розділені —
   remote removal не видаляє downloaded story мовчки; storage
   estimate/persist, quota errors, cancel, interrupted download і явний
   cleanup UI; відмову persistent storage показано чесно; без download
   незнайома demo offline недоступна, але малювання не блокується.
   Guard: `node --test` на IDB schema contract, атомарність перерваної
   транзакції, відмову приймати opaque response, розділення каталогів;
   наявні `npm run test:story-demo` і `npm run build` лишаються зеленими.
   Probe: зберегти story offline, зробити cold start без мережі — вона
   відтворюється; незбережена відхиляється явно й shell працює; перервати
   download посередині — жодного напівзаписаного record; відмова persist
   показана як відмова.
   Межа: обидва demo origin віддають ACAO з конкретним production origin,
   тому на будь-якому іншому origin ця фаза позначається NOT TESTED, поки
   origin не додано в allowlist CDN (див. відкриті питання).

10. **Фаза 10 — release QA (scope D).**
    Контракт: preview deploy і update matrix V1 → V2 з cleanup та другою вкладкою на
    ньому; реальні Android Chrome та iOS Safari / Add to Home Screen через
    https preview URL (SW не реєструється на `http://LAN-IP`); live перевірка
    фактичних CDN headers і побайтний readback артефактів після кожного
    deploy; оновлені `docs/SDLC.md` і `DEPLOY.md` (headers,
    update/release та операційна повторна публікація коду, не локальний rollback); негативна матриця §9 пройдена або
    явно позначена NOT TESTED там, де пристрою чи origin немає.
    Guard: `make verify` і повний набір guard'ів фаз 1–9 зелені на тому
    самому артефакті, що публікується.
    Probe: на preview URL з пристроїв — standalone cold launch, offline
    launch, повернення у foreground з оновленням; на production (лише після
    окремого дозволу власника) readback exact assets/headers.
    Межа: production deploy цим handoff не авторизований; SwiftShader,
    браузерні й фізичні результати не складаються в одне число, а
    відсутній пристрій позначається NOT TESTED, не PASS.

## Відкриті питання й зовнішні передумови

- **Icon master — рішення закрите власником 2026-10-14.** Вказано існуючі
  assets у `D:/work/js-games/ua-dream/tilecraft/images/icons/` і manifest у
  `tilecraft/manifest.webmanifest`. Інспектовано 733/512px арт; master взято
  з `icon-733-maskable.png` (733×733), byte-for-byte retained тут. Не upscale.
  Provenance і recipe — `assets/PROVENANCE.md`. Арт owner-directed, нової
  ліцензії на нього не вигадано; manifest адаптовано до Fluid Paint, без
  StoryTilecraft/Android identity. Це не відкрита передумова фази 1.
- **CORS allowlist демо-CDN.** `cdn.storytilecraft.cc` і r2.dev віддають
  `Access-Control-Allow-Origin: https://fluid.storytilecraft.space`. Чи
  додавати preview-origin Netlify в allowlist (потрібен доступ до
  Cloudflare/R2 конфігу), чи scope C QA лишається production-only — від
  цього залежить обсяг фаз 9 і 10.
- **Зміна схеми імен assets.** Фаза 2 прибирає фіксовані `/bundle.js` і
  `/app/layout.css` з production. У репозиторних документах прямих зовнішніх
  посилань на ці URL немає (embedded host відкриває сторінку, не bundle), але
  власник дозволив міграцію «Починай фазу 2» після повідомлення про ці URL.
  Це не незалежний зовнішній consumer audit; deploy все ще окремо заборонений.
- **Дозвіл на production deploy** — окремий крок власника після фази 10;
  спека його цим документом не дає.
- **Фізичні пристрої для фази 10** — потрібні реальні Android Chrome та iOS
  Safari; без них відповідні рядки матриці лишаються NOT TESTED.

```
handoff:start fluid-pwa
```

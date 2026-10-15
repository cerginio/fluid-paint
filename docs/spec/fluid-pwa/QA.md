# QA: Fluid PWA

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
- Full details and exact source list: [AUTOSAVE-REVISION.md](./AUTOSAVE-REVISION.md). Physical/native/Safari/CORS/retention/rollback debt unchanged. 7A прийнята через `handoff:next`; фаза8 не починалась і потребує окремого дозволу.


Фази 1–7 закрито; регресійні сценарії перенесено в [_archive/QA-phases-1-7.md](_archive/QA-phases-1-7.md) (2026-10-15); [парний handoff](_archive/HANDOFF-phases-1-7.md).
**Журнал фаз: 7A прийнята власником через `handoff:next` 2026-10-15 й закрита.** Чинний minimal-status/automatic-PNG контракт — угорі та в AUTOSAVE-REVISION.md; QA-7AICON-* нижче — історичні. Closing guards:63 executions passed/0 failed (6 entrypoints, включно з повторно imported activation cases). Browser probe збережено як PASS_WITH_LEGACY_LIMITATION, не замінено новим full-suite claim. QA-7AUX-* збережено як попередній eval. Фаза7 прийнята із боргом. **Local dist оновлено за прямим дозволом власника; поточний localhost/icon revision нижче supersedes historical unchanged-dist snapshots.**

**Історичний draft review 7A (glyph icons, НЕ новий icon revision):** https://6ad0c2e352ccd54a95955f40--fluid-paint.netlify.app/?webgl=2&debug=none&diag=0&seed=41 . Deploy `6ad0c2e352ccd54a95955f40`, release `5428e7edb05515295651bd02da1b719608c462cbc1bd40e0851cbb1cc142d47d`. Scoped generated manifest MIME fix + immutable caching guard PASS (detection 16/0, release 4/0, worker 12/0, isolated build). 23 exact HTTPS paths; manifest `application/manifest+json`. Real Chromium HTTPS SW complete/pinned readiness, offline reload/draw і browser close → persistent-profile cold offline relaunch/draw **PASS**. Evidence `$D/mime-https-smoke/result.json`, `mime-http-readback.json`, `mime-deploy-api.json`; `$D = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-7a-deploy-1gnw78cd`. Original draft `6ad0c00e8ec266d079ad3f37` MIME FAIL і launcher/guard failures збережено як history у [report](./PHASE7A-REPORT.md). Original canonical 26 commands exit0 є попередньою full verify evidence; affected rerun/current smoke foreground PASS. Production/commit/owner acceptance не виконано; physical/native/CORS борг збережено.

## Historical review — SVG Repo icon-only update

**Відкрити:** http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41 . Release `ca3c9da7eb4d622d0b7ee3f58d012a23384a79d8495758852b6a813857285148`; retained node.exe PID31212/parent70768, без restart. Власник авторизував local replacement. Старий Netlify draft вище — historical glyph-version; зовнішнього redeploy/commit/acceptance немає. Новий icon revision supersedes нижчі old-dist/count/screenshot snapshots, не їхні safety contracts.

**Як отримати update у вже відкритій старій вкладці:** відкрити PWA → Check for updates → дочекатися Update ready → Update. Прочитати warning, Export PNG і перевірити файл; тільки тоді окремо підтвердити. Cancel лишає старий документ/малюнок. Якщо активний мазок/import/export/Bake/playback, спершу завершити власну операцію. Не очищати site data/cache й не застосовувати forced reload як спосіб оновлення artwork. Лише requesting tab reloads після explicit consent. До publish «No updates found» було очікуваним для старого served artifact; тепер actual V1→new waiting перевірено на цьому exact origin.

Evidence: `$E = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-eanPOO`, `$L = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-local-icons-mGPEXY`.
`$E/result.json` PASS/13 commands exit0; guards activation12/0, detection16/0, readiness11/0, worker12/0, UX5/0. Browser production10/0, readiness13/0, detection7/0, actual V1/V2 activation14/0. `$L/publish-readback.json` та `$L/result.json` PASS: 183 frozen-source SHA checks,19 inventory+SW/release/inventory metadata (22 HTTP paths) exact, actual persistent old V1 artwork → new waiting → Cancel/no reload → own-test explicit consent/reload1, nonconsenting V1 unchanged. Protocol/worker/Paint safety не змінено. Exact source/license: [Dazzle UI / SVG Repo / CC BY4.0](../../../assets/pwa-ui/README.md). Physical/native/Safari/CORS/phase8 debt лишився.

### QA-7AICON-1. Справжні SVG та компактний dock

**qa:mode:** browser
**qa:open:** live localhost URL вище; `$L/ux-1000-actions.png`, `$L/ux-320-actions.png` (обидва viewport перевірено probe).
**qa:action:** відкрити PWA summary; focus Check for updates, Enter; відкрити Details & install; Escape.
**qa:inspect:** coherent 22px outline SVG icons cloud/check/refresh/clock/update/download/info/chevron; English title/accessible name; license credit у Details. `$E/activation-browser/ux-*` також включає waiting/consent/error/file-confirmation coverage.
**qa:expected:** action buttons ≥44×44px, SVG aria-hidden/nonfocusable, немає Unicode substitute icons. Collapsed49px, no horizontal overflow, canvas/File/Player/State над dock. Text status не color-only; Enter/Escape/focus працюють. Existing mobile Story/main panel overlap не є цим scope.

### QA-7AICON-2. Реальний старий localhost client бачить новий waiting

**qa:mode:** browser
**qa:open:** localhost URL у вкладці, що залишилася на V1; виконаний proof `$L/local-v1-new-icons-waiting.png`, `$L/local-v1-explicit-consent.png`, `$L/result.json`.
**qa:action:** Check for updates → Update → Cancel. Після окремого збереження/перевірки artwork — нове Update та explicit file confirmation; discard лише якщо свідомо дозволена втрата. Probe використала discard тільки власного тестового artwork.
**qa:inspect:** new release `ca3c9da7…` complete waiting, active спершу old `4e6ce90e…`; warning про artwork/wet/Undo; іншу nonconsenting вкладку.
**qa:expected:** registration.update `/sw.js`, scope `http://127.0.0.1:3000/`, updateViaCache none; без consent old document/artwork збережені. Cancel не reload/ALLOW. Після explicit own consent лише requesting tab робить один verified reload до new shell, інші documents не reload. `$L` persistent profile існував до publish; не просто clean-profile new UI. User browser profile/cache не змінювався.

## Збереження review stand

Не запускати build/guards/probes, що переписують shared `dist`, поки він обслуговує retained stand власника. Нижчі команди — інструкції, не дозвіл зупиняти retained server; для нового eval потрібен isolated source/output або окреме рішення власника.

## Локальний запуск

Фаза 1 **прийнята власником** 2026-10-14 (`handoff:next`), закрита.
Production deploy не виконано; сценарії лишаються регресійними.
**Фаза 2 прийнята власником 2026-10-14 (`handoff:next`) і закрита.** Naming migration
авторизована «Починай фазу 2», незалежний external-consumer audit не заявляється.
Команди для Windows Git Bash, з кореня `D:/work/fluid-paint/fluid-paint`:

```sh
npm run build
npm run test:pwa-assets
NODE_ENV=production node --test debug/pwa-release-test.js
PORT=3000 NODE_ENV=production node node_modules/gulp/bin/gulp.js startServer
```

Відкрити `http://127.0.0.1:3000/`. Сервер віддає саме зібраний `dist`, без
перезбирання. Інтернет потрібний лише для першого встановлення npm-залежностей;
fonts/icons/shell локальні. Demo — окремий зовнішній каталог, не offline shell.
Після перевірки зупинити свій сервер **Ctrl+C**. Не зупиняти чужий процес;
якщо порт зайнятий, спочатку визначити власника.

Автоматична проба (ручний сервер має бути зупинений):

```sh
PWA_QA_PORT=3000 npm run test:pwa-assets:browser
PWA_QA_PORT=3000 npm run test:pwa-release:browser
```

Вона сама піднімає й зупиняє gulp server, перевіряє звільнення порту, записує
`result.json`, HAR, trace, server log і шість PNG **поза repo** в унікальний
каталог `%LOCALAPPDATA%/Temp/fluid-pwa/phase1-…`. Без `PWA_QA_PORT` бере вільний
динамічний порт. На цьому checkout Playwright/Chromium вже доступні.
Phase-2 runner сам робить два production builds; evidence — автоматичний unique
`phase2-…`. Не запускати guards/probes паралельно із сервером (працюють з dist).

## Фаза 7A — реалізовано, eval PASS, очікує owner review

Авторизація реалізації — відповідь `7a`; draft окремо авторизовано «Зроби деплой». **Не прийнято власником; commit/production не виконано; фаза 8 заблокована.** Corrected live preview та offline PASS — у преамбулі; initial MIME blocker збережено у report.
Повний звіт: [PHASE7A-REPORT.md](./PHASE7A-REPORT.md).

### Запуск без зміни retained stand

З root `D:/work/fluid-paint/fluid-paint` виконати:

```sh
node debug/pwa-phase7a-eval.js
```

Це **єдина команда для нового eval у shared checkout**: runner копіює актуальні tracked/untracked source files у новий external Temp, приєднує наявні node_modules, будує лише там. Retained server `127.0.0.1:3000` не зупиняє і root `dist` не змінює. На початку/в кінці читає exact retained HTTP assets/SW; цей сервер має бути доступний. Новий isolated index не є staging/commit у root repo. Інтернет для shell не потрібен; optional Demo/CDN може відмовити й не є предметом 7A.

Runner відкриває справжній Chromium/SwiftShader, сам знаходить свої вільні порти, виконує наведені нижче дії та закриває всі власні browsers/servers. Для окремих browser runners **спочатку перейти у створений `$E/source`**, не запускати їх з shared root: вони будують dist. Root result містить exact commands/cwd/env, stdout/stderr та codes. Native install dialog у final run не пропонувався — він NOT TESTED, не синтетичний PASS.

Final `$E` = `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-azLg6U`, `$R = $E/activation-browser`.
Фактичний `$U` final run = `http://127.0.0.1:61427/?webgl=2&debug=none&diag=0&seed=41`.
**Цей URL уже закритий**, не живий review stand. Новий запуск runner автоматично відкриє новий URL з `activation-browser/result.json:url`; нижчі browser кроки вже виконані probe, а людина перевіряє PNG/JSON. Для повторення будь-якого сценарію виконати команду вище; жодних недоступних test hooks або вигаданого waiting worker вручну не потрібно.

Fresh guard окремо: activation **12/0**, detection **15/0**, readiness **11/0**, worker **12/0**, UX **4/0**. Browser окремо: production **10/0**, readiness **13/0**, detection **7/0**, activation **14/0**. UI geometry/accessibility matrix — 2 viewport records усередині activation result, не додаткові 14 cases. 13 top-level commands exit 0; не складати suites/levels в один test total.

### QA-7AUX-1. Isolated build та safety regression

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** `node debug/pwa-phase7a-eval.js`.
**qa:inspect:** надрукований `$E/result.json`, окремі `*.stdout.log` / `*.stderr.log`.
**qa:expected:** PASS/exit 0; counts вище, `retainedDistUnchanged=true`, retained before/after HTTP SHA-exact, усі 5 exact own ports bindable. Worker/activation factory tests не послаблено: unknown/missing safety не clean; busy/stale/storage refusal без ALLOW; once-only own reload/no claim збережені.

### QA-7AUX-2. Compact status, actions і keyboard

**qa:mode:** browser
**qa:open:** `$U` (відкриває runner); `$R/ux-1000-collapsed.png`, `ux-320-collapsed.png`, `ux-1000-actions.png`, `ux-320-actions.png`.
**qa:action:** focus `#pwa-panel > summary`, Enter; focus `#pwa-check`, Enter; Escape. Probe виконує ці дії на 1000×900 і 320×900.
**qa:inspect:** collapsed рядок, 44px icon buttons із English title/aria-label, focus outline, `result.json:ux`.
**qa:expected:** collapsed dock 49px; немає long IDs/paragraphs; статуси зрозумілі без кольору. Enter відкриває/перевіряє, Escape згортає й повертає focus summary. Visible focus outline не `none`; live status semantics збережені.

### QA-7AUX-3. Details і відсутність overlap

**qa:mode:** browser
**qa:open:** `$U`; `$R/ux-1000-details.png`, `ux-320-details.png`.
**qa:action:** відкрити Story tools через `#panel-extension-toggle`; focus `#pwa-details > summary`, Enter.
**qa:inspect:** technical disclosure, File/Player/State tabs; `ux[].expanded` geometry.
**qa:expected:** shell/release IDs, timestamp і preparation details — лише secondary disclosure. Немає horizontal overflow. Canvas bottom ≤ dock top; File/Player/State та drawing bar bounds над dock на обох viewport. At 320×900 expanded dock y=446, canvas bottom=446; content має internal scroll, не overlay. Існуюче взаємне накладання mobile Story tools/main panel не змінено цією фазою.

### QA-7AUX-4. English loss consent і cancel

**qa:mode:** browser
**qa:open:** `$U` з actual V1/V2, який готує runner; `$R/dirty-consent.png`, `ux-320-consent.png`.
**qa:action:** реальний pointer stroke → `#pwa-apply` → `#pwa-cancel`.
**qa:inspect:** English artwork/wet paint/Undo loss і flattened/not-backup warning; `drawn.safety` та verified waiting identity у result.
**qa:expected:** dirty=unknown; concise explicit consent називає всі втрати; `#pwa-saved` ще hidden. Cancel не ALLOW/reload; artwork/V1 лишаються, V2 waiting. Focus після Cancel повертається до Update. Окремий held-stroke case не обрізає активний мазок.

### QA-7AUX-5. PNG error не застосовує update

**qa:mode:** browser
**qa:open:** `$U`; `$R/png-error-no-activation.png`, `ux-320-error.png`.
**qa:action:** probe тимчасово дає actual browser encoder callback null; `#pwa-apply` → `#pwa-export`, потім відновлює encoder.
**qa:inspect:** live error `PNG export failed. Update not applied.`; disabled export/discard, доступний Cancel і Update retry.
**qa:expected:** V1 active/V2 waiting, жодного silent discard/ALLOW. Помилка видима на 320px і має role=status; нове рішення вимагає повторного Update, а не автоматичного fallback.

### QA-7AUX-6. Справжній PNG та окреме file confirmation

**qa:mode:** browser
**qa:open:** `$U`; `$R/confirmed-artwork.png`, `export-awaiting-separate-confirmation.png`, `ux-320-file-confirmation.png`.
**qa:action:** `#pwa-apply` → `#pwa-export`; probe зберігає actual download; відкрити PNG й перевірити його; лише потім `#pwa-saved`. Окремий fresh-profile case натискає `#pwa-discard` без export.
**qa:inspect:** PNG 180×130, 20483 bytes; English `Open and check the downloaded PNG` та `File checked — update anyway`; `explicit-discard-v2.png`.
**qa:expected:** download.failure=null, непорожній flattened PNG; export completion ще не activation. File confirmation і explicit discard — різні дії, обидві після loss warning; wet paint/Undo не відновлюються. Only requesting tab reloads exactly once to verified V2; інші tabs не reload.

### QA-7AUX-7. Install без вигаданого prompt

**qa:mode:** browser
**qa:open:** `$U`; `$R/ux-1000-install.png`, `ux-320-install.png`; `$E/readiness-browser/ios-ua-instructions.png`.
**qa:action:** відкрити `Details & install`, прокрутити `#pwa-install-info`; окремий Chromium iPhone-UA context виконує той самий крок.
**qa:inspect:** `Use the browser menu: Install / Add to Home Screen` або genuine offered install control; iOS-UA `In Safari: Share → Add to Home Screen. No automatic install.`.
**qa:expected:** fallback читабельний; `nativePromptOffered=false` у final run, Install hidden без genuine event. Жодного synthetic install/native-dialog acceptance. iOS-UA — не Safari/physical acceptance. Embedded page взагалі не має PWA dock.

### QA-7AUX-8. Actual V1/V2 matrix та once-only reload

**qa:mode:** cli
**qa:open:** термінал у root; `$R/result.json`, `cache-snapshot.json`, `v2-requesting-tab-verified.png`, `nonconsenting-old-tab-after-activation.png`, `persistent-cold-v2.png`.
**qa:action:** `node debug/pwa-phase7a-eval.js`; прочитати activation cases і production regression result.
**qa:inspect:** retained 14 activation cases: real stroke/export/Bake/import/playback, frozen nonconsenting tab, uncontrolled/race tabs, saved/discard routes, exact cached inventories, cold offline restart.
**qa:expected:** activation 14/0; V2 verified до resume frozen tab; requesting navigation count=1, consumed marker=null; old documents і old-hash bytes збережені. Production 10/0 включає WebGL1/2/Bake/PNG/import/bounded playback, failed installs/embedded security/natural activation. Не physical mobile suspension, не full large-story playback і не phase-8 retention/cap acceptance.

## Історичні snapshots фази 7 (не поточний UX 7A)

Нижчі QA-7A–7M, QA-6F і QA-5G збережено як історію протоколу та попереднього layout/copy. Їхні старі тексти/селектори не є поточними UX acceptance assertions. Свіжі selectors/copy/probes і counts — QA-7AUX-* вище. Physical/CDN/CORS/full-verify та historical cleanup-readback limitations залишаються боргом.

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

## Фаза 7 — безпечна активація (прийнята й закрита із follow-up 7A)

**Прийнято власником через `handoff:next` 2026-10-15 із обов’язковим UX follow-up 7A.**
Closing commit поверх `5d900c1`; фази 1–7 прийняті. Preview/production deploy не виконано.
Далі — **окремий дозвіл на 7A**, не реалізація фази 8. 7A зараз лише контракт/checklist.
Фаза 8 заблокована до реалізації, eval і acceptance 7A та окремого дозволу. Контракт/source tracing/межі:
[PHASE7-REPORT.md](./PHASE7-REPORT.md). Нижчі phase-6 no-activation записи — історичні.

Запуск із кореня checkout (без іншого server/dist writer):

```sh
node debug/pwa-phase7-eval.js
# Лише нова production V1/V2 матриця:
node debug/pwa-activation-browser-test.js
```

Runner сам збирає, запускає й завершує свої servers/browsers. Evidence — новий
унікальний Temp поза repo. Для звичайного single-build ручного review придатні
команди преамбули: `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`.
Такий single build сам по собі **не** створює V1/V2 waiting: exact update matrix
виконує нова probe. Історичний eval stand автора завершено; поточний retained stand див. closing check. Інтернет не потрібний для
shell; зовнішні Demo/CORS не є acceptance цього eval. Production deploy заборонено.

Історичний final `$E` =
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J`;
`$R = $E/activation-browser`; historical actual `$U` =
`http://127.0.0.1:51333/?webgl=2&debug=none&diag=0&seed=41`.
`$U` — історичний URL з evidence, не живий стенд; поточна вільність порту не заявляється. Нижче browser
сценарії виконані actual probe; для human review відкрийте відповідні PNG і JSON.

Історичний runner PASS/exit 0: **22 commands exit 0**. Guard окремо passed/failed:
activation **12/0**, detection **15/0**, readiness **11/0**, worker **12/0**,
release **4/0**, assets **7/0**, harness **5/0**, shader **25/0**, demo **8/0**,
palette **6/0**; control API PASS без enumeration. Browser окремо: activation
**14/0**, detection **7/0**, readiness **13/0**, production **10/0**, assets
**2 viewport**, release **2 WebGL**, fixture **8 cases**. Не сумувати рівні/suites.
Попередні phase-1–6 числа нижче — історичні. Final all-suite logs — `$E/result.json`.

### QA-7A. Production factories та regression runner

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** `node debug/pwa-phase7-eval.js`.
**qa:inspect:** надрукований absolute evidence/result.json, окремі stdout/stderr.
**qa:expected:** PASS/exit 0, точні окремі counts вище. Actual production activation/worker/Paint implementations, не дубль алгоритму. Once-only marker тільки sessionStorage; no clients.claim, skipWaiting тільки verified ALLOW; unknown/missing safety, stale worker, storage refusal не активують. Повний make verify не заявляється.

### QA-7B. Unknown dirty і відмова користувача

**qa:mode:** browser
**qa:open:** `$U` із V1 active/V2 waiting; `$R/dirty-consent.png`.
**qa:action:** після реального мазка відкрити «Offline / встановлення» → «Оновити» → нижнє «Пізніше» (`#pwa-cancel`).
**qa:inspect:** текст consent про потенційно незбережений малюнок, мокру фарбу й Undo; identities у result.
**qa:expected:** production safety dirty=unknown, не clean; явна відмова лишає V1 active, V2 complete waiting і artwork. Жодного ALLOW/reload. Навіть порожній canvas не оголошується гарантовано saved.

### QA-7C. Мазок не обрізається

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/active-stroke-refused.png`.
**qa:action:** виконати QA-7A; знайти case held actual pointer stroke.
**qa:inspect:** strokeActive до/після відмови, drawn.magnitude і current release.
**qa:expected:** active=true; updater не викликає endStroke і не reload. Pointer up завершує справжній мазок, потім потрібний новий «Оновити». Проба навмисно DOM-click-ає update при утриманому real pointer: звичайний mouse click спочатку відпустив би його.

### QA-7D. Реальний export in-flight

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/export-in-flight-refused.png`.
**qa:action:** знайти actual export-in-flight case після QA-7A.
**qa:inspect:** real toBlob callback gate та production operation counter.
**qa:expected:** update відмовляє, поки encoder не завершився; V1 active/V2 waiting. Після відпускання callback справжній export Promise успішний. Це timing instrumentation реального browser encoder, не вигаданий Blob чи saved-file proof.

### QA-7E. PNG error не дає activation

**qa:mode:** browser
**qa:open:** `$U`, `$R/png-error-no-activation.png`.
**qa:action:** probe відкриває «Оновити» → «Завантажити PNG» з encoder callback null; після цього повертає оригінальний encoder.
**qa:inspect:** стійке «PNG export не вдався. Оновлення не застосовано.».
**qa:expected:** V1 active/V2 waiting, помилка не переходить у discard/ALLOW автоматично. Для нового рішення потрібний повторний «Оновити»; controls не залишаються inert після error.

### QA-7F. Окрема згода після справжнього PNG

**qa:mode:** browser
**qa:open:** `$U`; `$R/export-awaiting-separate-confirmation.png` та `$R/confirmed-artwork.png`.
**qa:action:** «Оновити» → «Завантажити PNG»; відкрити збережений файл; лише потім «PNG збережено — оновити все одно» (`#pwa-saved`).
**qa:inspect:** синій artwork 180×130, текст «Перевірте файл PNG на диску, потім окремо підтвердьте оновлення».
**qa:expected:** справжній download.failure=null, PNG 180×130 непорожній (у цьому final 17811 bytes); до другої кнопки V1 ще active. PNG — flattened image, не wet simulation/Undo checkpoint; API completion саме по собі нічого не активує.

### QA-7G. Import та Bake не перериваються

**qa:mode:** cli
**qa:open:** `$R/result.json`, actual Bake/local story loading cases.
**qa:action:** QA-7A; прочитати обидва відокремлені cases.
**qa:inspect:** Bake Promise на async yield boundary; full retained story import на File.text boundary.
**qa:expected:** кожна production operation блокує лише власну activation; після відмови реально завершується. Story успішно імпортована, V1 identity незмінна. Це real API з контрольованим timing, не просто присвоєння busy=true. Retained regression додатково виконує UI Bake та PNG import без цих gates.

### QA-7H. Playback не зупиняється updater-ом

**qa:mode:** browser
**qa:open:** `$U`; `$R/playback-refused.png`.
**qa:action:** probe викликає actual production `controller.play()` → DOM «Оновити»; після перевірки QA явно викликає `stop()` та `keepResult()`, тоді повторює «Оновити».
**qa:inspect:** Player state=playing під час відмови; paused також вважається active (production API guard).
**qa:expected:** updater не pause/stop/restart playback; reload немає. QA потім явно зупиняє story. Full large-story completion цим сценарієм не приймається.

### QA-7I. Інші вкладки — notification, не lock

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/export-awaiting-separate-confirmation.png`.
**qa:action:** знайти uncontrolled bootstrap та nonconsenting вкладки, activationWhileFrozen.
**qa:inspect:** UI «Відкрито ще 2 вкладок (включно з uncontrolled)»; source worker matchAll includeUncontrolled; BroadcastChannel note.
**qa:expected:** count включає same-scope uncontrolled. Actual nonconsenting tab frozen через CDP; V2 active/verified записано при otherStillFrozen=true **до resume**. «Оновити все одно» доступне після власного work gate; жодних client replies/quorum. Це desktop Chromium freeze, не physical suspended mobile acceptance.

### QA-7J. Нова вкладка у applying window

**qa:mode:** browser
**qa:open:** `$U&openedDuringApply=1`; `$R/new-tab-during-apply-old-shell.png`.
**qa:action:** probe тримає лише доставку genuine ALLOW message, відкриває нову вкладку pinned V1, потім відпускає повідомлення.
**qa:inspect:** V1 title/loaded document marker; result compat та cache-snapshot.json.
**qa:expected:** нова вкладка не втрачає V1 документ після V2 activation; offline old-hash JS fetch через новий SW має HTTP200/exact V1 SHA. Обидва complete inventories SHA-exact. Це детермінований pre-ALLOW applying race, не твердження про довільне timing браузера; cap/cleanup не реалізовано.

### QA-7K. Один reload лише requesting tab

**qa:mode:** browser
**qa:open:** `$R/v2-requesting-tab-verified.png`, `$R/nonconsenting-old-tab-after-activation.png`, result.
**qa:action:** перевірити стан після QA-7F та після наступного очікування probe.
**qa:inspect:** requesting navigation count=1, verified loaded target; original document markers інших tabs; sessionStorage marker=null.
**qa:expected:** requesting tab title V2 Fluid Paint, releaseId `699be88cc7ab9d5df2604b71d15dc35e5cbe35aad5ed35d6c62ec37238139cb0`; nonconsenting/race tabs лишаються V1 без reload. Uncontrolled tab не claimed. Повторні events/очікування не створюють loop; mismatch має error без другого reload (guard).

### QA-7L. Явне оновлення без збереження

**qa:mode:** browser
**qa:open:** той самий origin у незалежному persistent discard-profile; `$R/explicit-discard-v2.png`.
**qa:action:** «Оновити» → прочитати втрату мокрої фарби/Undo → «Оновити без збереження — оновити все одно» (`#pwa-discard`).
**qa:inspect:** verified V2 після actual DOM consent, без PNG API.
**qa:expected:** explicit discard є окремою дією, не автоматичним fallback після помилки. Target loaded shell/release verified, no loop. Жодна інша вкладка не перезавантажується цим рішенням.

### QA-7M. Persistent cold start та natural activation regression

**qa:mode:** cli
**qa:open:** `$R/persistent-cold-v2.png`, `$R/result.json`; `$E/production-regression/result.json`.
**qa:action:** QA-7A; прочитати context closures, cold-v2 і retained natural activation cases.
**qa:inspect:** той самий profile після повного browser close; offlineBeforeNavigation, fromServiceWorker; natural activation без ALLOW після закриття всіх clients.
**qa:expected:** cold V2 працює offline, artwork/wet/history автоматично не відновлюються. Retained production suite 10/0 з WebGL1/2/Bake/PNG/import/bounded completed playback/failed installs/embedded security/natural activation. Це не OS reboot, physical standalone чи full великої story completion.

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

### Межі фази 7 / cleanup

Історично own browsers disconnected, eval servers stopped; final ports
57245/61163/61694/61152/53415/59252/59027/51333 тоді незалежно bind-back PASS.
Root result містить exact command. Первинний post-document verifier перевірив 45 own ports і 118 media artifacts; його PASS історичний. Поточний verifier FAIL на сторонньому 51333 описано вище, не browser FAIL. Retained review stand на 3000 збережено за вимогою власника (closing check). Чужих процесів не чіпали. Фази 8–10 не
реалізовано; cap/cleanup/rollback/offline demos не додані. Physical Android/iOS,
Safari/A2HS/standalone/native GPU/OS reboot, real mobile suspension/native install
dialog, quota/eviction/browser MIME/hash injection, full large-story playback,
live CDN/Netlify headers/CORS/demo downloads та full make verify — **NOT TESTED**.
Попередні помилки, instrumentation та source tracing — report; невдалі спроби
не є acceptance. Наступний крок — **окремий дозвіл на 7A**, не phase-8 implementation.

### QA-6F. Mobile width та повні identities

**qa:mode:** browser
**qa:open:** друга вкладка QA-6E, viewport 320×900; `$R/320-waiting.png`.
**qa:action:** залишити summary відкритим після QA-6E, змінити viewport на 320×900.
**qa:inspect:** обидва довгі releaseId та bounds панелі.
**qa:expected:** x=12, width=296, horizontal overflow=false; IDs переносяться, обидві кнопки доступні, вертикальний internal scroll дозволений. Warning видимий і collapsed. Це Chromium viewport, не фізичний телефон; expanded disclosure можна згорнути перед drawing.

### QA-5G. 320px, клавіатура і видиме попередження

**qa:mode:** browser
**qa:open:** local URL після QA-5C, viewport 320×900; `$R/320-ready.png`, `320-warning-collapsed.png`.
**qa:action:** focus summary «Offline / встановлення»; Enter згортає/розгортає; перевірити desktop 1000×720. Для State/Bake — retained production probe без force clicks.
**qa:inspect:** disclosure bounds і текст; коротке жовте попередження у згорнутому стані; основні controls згори.
**qa:expected:** x=12, ширина 296px на 320px, без horizontal overflow; текст читабельний; native keyboard працює, focus видимий, warning не зникає при згортанні. Панель знизу не перехоплює State tab. Це viewport Chromium, не телефон. Embedded `?embedded=1`/iframe не отримує PWA overlay.

## Межі й не перевірене

- Історично фаза 2 додала inventory без CacheStorage; фаза 3 — лише fixture.
  Фаза 4 тепер реалізує production SW/app offline cold start, див. QA-4/report.
  Фаза 5 прийнята: readiness/install UX (див. QA-5);
  фаза 6 прийнята: detection/Later та hosting header definitions.
  Safe activation/reload прийнято у фазі 7 із обов’язковим UX follow-up 7A перед 8; live Netlify/CDN/deployment acceptance ще не виконані.
  Фаза 1 не додавала hashing (історичний факт); no-SW expectations фаз 1–3
  superseded фазою 4, fixture byte-preservation guard збережено.
- Android/iOS standalone та фізичні пристрої — NOT TESTED, майбутні фази.
  Production cold start підтверджено тільки desktop Chromium/SwiftShader.
  Ширина 320px — desktop Chromium viewport, не телефон.
- Відкриття + ініціює чинний запит Demo index до CDN (2 запити у пробі).
  Це optional app data, не HTML/CSS/manifest dependency; CORS/demo playback
  та доступність зовнішнього каталогу не приймаються цією фазою.
- На mobile story panel накладається на основну й має прозорий фон; це чинний
  layout. Geometry і fonts перевірено, новий UX тут не реалізовано.
- Зовнішні footer anchors прибрані задля буквального guard «0 cross-origin
  HTML links»; attribution-текст незмінний, URLs збережені в assets/PROVENANCE.md.
- Icon master owner-directed; нової ліцензії на чужий арт не вигадано.

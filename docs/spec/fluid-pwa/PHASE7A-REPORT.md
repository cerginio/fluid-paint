# Фаза 7A — компактний PWA UX

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
- Full details and exact source list: [AUTOSAVE-REVISION.md](./AUTOSAVE-REVISION.md). Physical/native/Safari/CORS debt unchanged. 7A прийнята через `handoff:next`. Старий retention/cap/локальний rollback scope скасовано власником; scope8 (cleanup + дві вкладки) реалізовано за окремим дозволом, очікує human review; поточні докази й обмеження — PHASE8-REPORT.md. Чинний контракт — HANDOFF.md та PWA-OFFLINE-UPDATE-SPEC.md §4.1; історичні вимірювання не змінено.


Стан на 2026-10-15: **реалізовано, eval PASS, передано на review; НЕ прийнято власником**.
Реалізацію авторизовано відповіддю `7a` після read-only входу. Commit не виконано. За окремим «Зроби деплой» опубліковано draft preview; production не змінено. Поточний виправлений deploy/readback і offline PASS — нижче; MIME blocker першої спроби збережено як історію; попередні no-preview/full-verify записи далі є історичними.
Історичний checkpoint: 7A тоді очікувала acceptance. Зараз 7A прийнята й закрита; наступний scope — cleanup + дві вкладки за актуальним HANDOFF, не попередня retention/cap/rollback фаза. Scope8 відтоді реалізовано за окремим дозволом; очікує human review, див. PHASE8-REPORT.md.

## Historical SVG Repo icon-only localhost review

Власник явно дозволив «Доробляй іконки. Візьми іконки з svg repo site. Локальную версію онови».
**Виконано; owner acceptance 7A ще немає.** Preview нижче — історична glyph-версія, повторного external deploy не було.

- Поточний live review: **http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41**.
- Release **`ca3c9da7eb4d622d0b7ee3f58d012a23384a79d8495758852b6a813857285148`**, shell `a240a214d02c25868c8e6cd0f920dec1461d1fcb4d21e064641e75cc66db1d42`.
- Exact retained server **node.exe PID31212**, parent70768, `node_modules/gulp/bin/gulp.js startServer`, 127.0.0.1:3000: не перезапускали. Prepared directory swap двома synchronous rename зайняв **3.9083ms**, не partial build-in-place. Старі immutable hash URLs залишено; повна попередня dist копія у `$L/old-dist-backup`. Це не твердження про filesystem atomic exchange.
- **9 справжніх Dazzle Line SVG**, creator **Dazzle UI**, **CC BY 4.0**. Exact SVG Repo pages/download URLs/SHA: [assets/pwa-ui/sources.json](../../../assets/pwa-ui/sources.json); license/provenance/adaptations: [README](../../../assets/pwa-ui/README.md). Завантажено bytes з `www.svgrepo.com/show/…`, не намальовано схожі paths. HTML metadata Vercel-blocked; attribution mirror/license corroboration записано чесно у README.
- `debug/generate-pwa-ui-icons.py` XML-whitelist → `app/pwa-ui-icons.js`: лише inert geometry/presentation, currentColor; no script/image/use/href/animation. Production concat завантажує icon helper перед controller; dev/embedded exclusion лишився. 22px/24-viewBox/2px rounded strokes, native **44×44px** actions; accessible names/title/English status/keyboard/live semantics збережено. Glyphs та CSS Unicode chevrons прибрано. Credit/license URL також видимі в Details & install. Owner PNG icon artwork не змінено.
- `$E = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-eanPOO`: **PASS, 13 commands exit0**. Guards окремо: activation **12/0**, detection **16/0**, readiness **11/0**, worker **12/0**, UX **5/0**. Browser окремо: production **10/0**, readiness **13/0**, detection **7/0**, actual V1/V2 activation **14/0**. V2 fixture `18601f862b9112a8ecb5bf5cb6387e9b9e24188b015a6305122544f8ad018a55`. Не full make verify rerun.
- `$E/activation-browser/ux-{1000,320}-{collapsed,actions,details,install}.png`, `ux-320-{consent,error,file-confirmation}.png`: свіжі реальні screenshots/probes; actions desktop/320 переглянуто візуально. Collapsed **49px**, no horizontal overflow, canvas/tabs над dock. Actual export PNG **180×130/20242 bytes**. Safety matrix включає stroke/export/import/Bake/playback/frozen/nonconsenting/race tabs/once-only reload/cold offline; protocol/worker/Paint safety не послаблено.
- `$L = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-local-icons-mGPEXY`: `publish-readback.json` **PASS** — **183** source files SHA-exact до frozen eval перед publish; усі **19 inventory entries + SW/release/inventory metadata (22 paths)** HTTP200/SHA-exact. Нові metadata/SW bytes перевірено вже на exact localhost:3000.
- `$L/result.json` **PASS** — власний persistent V1 profile був відкритий **до** publish; справжній pointer artwork, V1 complete/controller. До publish no-update очікуваний. Після publish **`registration.update()`**, scope `http://127.0.0.1:3000/`, script `/sw.js`, updateViaCache `none` → exact new **complete waiting** identity; old active/artwork/document незмінні. Update → consent → Cancel без reload. Лише наступний explicit discard **власного тестового** artwork → **один** verified reload; nonconsenting V1 tab зберегла document marker. New desktop/320 SVG UI та complete cached inventory SHA-exact. Обидві own browser tabs закрито; user browser/profile/cache не чіпали.
- Local screenshots: `$L/local-v1-new-icons-waiting.png`, `local-v1-explicit-consent.png`, `local-new-icons-verified.png`, `ux-320-actions.png`; HAR/trace/cache snapshot поруч. Не просто fresh clean-profile screenshot.
- Post-document verifier: `node C:/Users/cergi/AppData/Local/Temp/fluid-pwa-local-icons-mGPEXY/verify-evidence.cjs` **PASS/exit0**: **23** current HTTP paths (додатково root `/`), **18** retained old immutable hash paths SHA-exact;183 source SHA checks,106 PNG/ZIP/HAR signatures/JSON, document links,5 own ports bind-back, exact PID31212. HEAD unchanged `34228fe674ad8a6e35222f4c1b860db5f5886353`, index empty, `git diff --check` PASS. Fresh exact command/profile process query не виявила own final/intermediate node/Chromium leftovers; retained server не зупиняли.
- Final own eval ports **52416,52282,55007,56635,60642** bind-back PASS; local test server не запускався/не зупинявся, retained3000 лишено за дозволом власника.

### Проміжні невдалі спроби icon revision

Не рахуються PASS: promoted background shell `stdin is not tty`; foreground tool timeout `$Temp/fluid-pwa-phase7a-O3Zmq0`; `$Temp/fluid-pwa-phase7a-2w5Bz6` — CommonJS helper у concatenated browser runtime блокував startup (виправлено browser global + explicit production order, додано VM/order guard). Точні own failed-probe browser73380/node58536 зупинено після fresh identity readback; own61432 bind-back PASS. `$Temp/fluid-pwa-phase7a-MCzOLv` — старий brittle production-inclusion regex виправлено на той самий invariant із additional helper. `$Temp/fluid-pwa-phase7a-SNPQNK` — production10/0, але diagnostic mismatched-shell fixture inject-ала controller без нового helper: fixture dependency додано, mismatch assertion не послаблено. Final повний 13-command rerun `$E` PASS. Isolated runner тепер також fetch-ає existing HEAD без нового commit для revision metadata; shared index не змінює. Physical/native/Safari/CORS/phase8 борг нижче лишається.

## Що змінено

## Draft preview 7A — 2026-10-15

- **Historical glyph preview (не новий icon revision): https://6ad0c2e352ccd54a95955f40--fluid-paint.netlify.app/?webgl=2&debug=none&diag=0&seed=41**.
- Deploy ID `6ad0c2e352ccd54a95955f40`, site `79a5d98c-0ff5-47fd-b048-64d714854ff9`; API readback `state=ready`, `context=deploy-preview`, `published_at=None`. Draft only; production/commit/acceptance 7A/8 не виконано.
- Hosting fix: `debug/pwa-release-build.js` генерує `Content-Type: application/manifest+json` лише для exact hashed manifest path у `_headers`, зберігаючи immutable cache header. `netlify.toml` і strict worker не змінено. Guard у `debug/pwa-detection-test.js` перевіряє exact manifest path, MIME і immutable caching, без wildcard.
- Release ID незмінний: `5428e7edb05515295651bd02da1b719608c462cbc1bd40e0851cbb1cc142d47d`; змінився hosting metadata, не shell bytes. Isolated build PASS; affected guards release **4/0**, detection **16/0**, worker **12/0**. `mime-build.log`, `mime-release.log`, `mime-detection.log`, `mime-worker.log` у `$D` нижче. Original 26-command canonical verify evidence лишається historical PASS для source до hosting correction; повний suite вдруге не запускався.
- Exact verified dist задеплоєно `netlify deploy --dir=dist --no-build --site=79a5d98c-0ff5-47fd-b048-64d714854ff9 --json` без `--prod`. `mime-deploy.json`, `mime-deploy-api.json`, `mime-http-readback.json`: **23/23 HTTPS paths exact bytes**, manifest HTTP200 `application/manifest+json`, `public,max-age=31536000,immutable`; fixed no-store/no-cache і решта immutable headers збережені.
- **Live HTTPS offline PASS** (`mime-https-smoke/result.json`): Chromium 153.0.8010.12/SwiftShader, actual complete active SW/pinned release, inventory cache SHA exact. Online drawing, offline SW-served reload/drawing, then browser close → persistent-profile relaunch with `offline:true` → cold HTTPS navigation served by SW/drawing PASS. `navigator.onLine=false` на cold launch, worker complete/exact release; GL error 0, page errors 0, shader requests 0. Cold drawing magnitude `12736.589157783974`. Це browser process cold restart, не OS reboot/native standalone.
- Screenshots/HAR/traces/cache evidence: `mime-https-smoke/https-draw.png`, `https-offline-draw.png`, `https-cold-offline-draw.png`, `cache-snapshot.json`, `https.har`, `cold-offline.har`, відповідні `*-trace.zip`; desktop/320 dock keyboard/details geometry також PASS. Обидва owned browser contexts closed/disconnected; локальних серверів новий smoke не запускав.
- Initial guard run мав probe escaping SyntaxError; виправлено, `mime-detection-first-failed.log` збережено, final guard PASS. Background launcher notification `proc_8957fdde8987` exit1 (`stdin is not tty`/no job control) не є suite verdict: actual `verify-result.json` містить PASS, усі 26 command exit0; current affected commands/smoke виконано reliable foreground. Failure notification disclosed, не підмінено PASS.

### Попередня невдала draft спроба — історія, superseded corrected draft вище

- Historical review: **https://6ad0c00e8ec266d079ad3f37--fluid-paint.netlify.app/?webgl=2&debug=none&diag=0&seed=41**.
- Deploy ID `6ad0c00e8ec266d079ad3f37`, site `79a5d98c-0ff5-47fd-b048-64d714854ff9`. API readback: `state=ready`, `context=deploy-preview`, `published_at=null`; не production, не acceptance 7A/8.
- Release ID `5428e7edb05515295651bd02da1b719608c462cbc1bd40e0851cbb1cc142d47d`.
- Evidence `$D = C:/Users/cergi/AppData/Local/Temp/fluid-pwa-7a-deploy-1gnw78cd`: `verify-result.json`, 26 exact stdout/stderr pairs, `deploy.json`, `deploy-api.json`, `http-readback.json`, `online-smoke/result.json`, `https-smoke/result.json` (FAIL), screenshots/HAR/traces.
- GNU Make відсутній. Виконано **всі 26 npm commands** з чинних Makefile `test-fast`, `test-browser`, потім `build`, строго послідовно в isolated source: усі exit 0. Додатково UX guard **4/0**. Це canonical `make verify` equivalent, не сума test cases. Root dist не будували.
- Перший isolated run впав через відсутній HEAD у новому git repo; приєднано existing HEAD `34228fe674ad8a6e35222f4c1b860db5f5886353` без нового commit. Другий впав у старому shader harness: production `/dist/index.html` на source origin давав `/sw.js` 404. Виправлено лише `debug/shader-bundle-gpu-test.js`: окремий origin-root production server із exact cleanup/bind-back; source examples збережено окремо, error assertions не послаблено. Після цього повний 26-command rerun PASS. Failure logs збережено.
- Upload exact verified dist: `netlify deploy --dir=dist --no-build --site=79a5d98c-0ff5-47fd-b048-64d714854ff9 --json`. `--no-build` потрібний поточному CLI, щоб не перебудувати вже перевірений artifact; `--prod` не використовувався.
- Live HTTPS: **19/19 inventory entries + `/`, SW, release/inventory metadata (23 unique paths)** HTTP200 і exact local bytes/SHA. HTML `/` та `/index.html` — `no-cache`; SW/metadata — `no-store`; усі 18 hashed assets — `public,max-age=31536000,immutable`. Bundle містить actual 7A disclosure/consent copy. `netlify.toml` та generated exact `_headers` збережено.
- **BLOCKER: offline readiness НЕ PASS.** Netlify віддає hashed `.webmanifest` як **`application/octet-stream`**. Production worker вимагає `application/manifest+json` (`app/pwa-worker.js:20–21`), install відхиляється, complete caches/active controller відсутні. Bounded real Chromium readiness FAIL, offline reload не заявляється. На цій першій спробі MIME gate не послаблювали. Цю відмову виправлено scoped hosting correction та новим draft/readback/cold-offline smoke вище; додаткового дозволу для correction у межах deploy не потрібно.
- Online HTTPS smoke **PASS_ONLINE_ONLY**: Chromium **153.0.8010.12/SwiftShader**, actual pointer draw material magnitude `12169.160316460924`, WebGL2 GL error 0; page errors 0, shader requests 0. Dock desktop 1000×900 та 320×900 **49px**, keyboard/focus/details/geometry PASS. `online-smoke/https-draw.png`, `ux-1000-collapsed.png`, `ux-320-collapsed.png`, details/install PNG. 320 screenshot візуально підтверджує compact row та чесний `Preparing offline / Update check failed`.
- Retained localhost:3000 PID31212 не зупиняли й root dist не перебудовували. `retained-before.json` / `retained-after.json`: усі 19 shell entries + SW/release/inventory (22 paths) SHA-exact до/після. `final-verification.json` та `process-readback.json`: HEAD/index і production sources unchanged, лише scoped shader harness/docs edits; власних probe node/Chromium leftovers немає, exact collected suite ports bind-back PASS. Чужі listeners не чіпали; це не global free-port claim.
- Optional Demo index fetch failure видимий при відкритті Story tools; CORS/demo downloads не є PASS. Physical/native/Safari/A2HS та phase-10 update matrix не перевірені. Локальні full-verify browser PASS не скасовують live MIME FAIL.

### Реалізація UX

- Замість багатослівної floating overlay — нижній icon-first dock. Collapsed стан: cloud glyph, короткі English offline/update status та disclosure indicator; **49px** на 1000×900 і 320×900.
- Verify / Check / Later / Update / Install — native buttons з glyph `aria-hidden`, English `aria-label` і `title`, min 44×44px. Enter активує, focus outline 3px; Escape закриває dock і повертає focus summary. Confirm/error повідомлення мають live status і отримують focus; Cancel повертає його до Update.
- Release IDs, pinned shell ID, timestamps, результати перевірки, preparation та install instructions — nested `Details & install`, closed by default. Pinned identity checks не прибрано; shell ID тепер також видно в disclosure.
- ResizeObserver резервує фактичну висоту dock у `#app`; canvas ResizeObserver лишається чинним. Dock не лежить над canvas/File/Player/State. Expanded content обмежено 45dvh з internal scroll; existing main/Story panel positioning не переробляли.
- PWA copy англійська. Пошук `i18n`, `localization`, `localisation`, `translations`, `locale` у app та огляд index/package не виявили локалізаційних catalogs/framework; `toLocaleTimeString`/`localeCompare` — форматування, не переклад. Новий framework/catalogs не додано. English-only PWA source перевіряє окремий guard.
- Consent прямо називає втрату artwork, wet paint та Undo; PNG flattened, не backup wet/history. Окремі Export PNG → перевірка завантаженого файлу → `File checked — update anyway`; альтернатива `Discard artwork — update anyway`, окремий Cancel. Export error не стає discard.

## Незмінні safety contracts

Зміни production обмежено DOM/copy/focus/layout. `createActivation`/`createDetection` control flow, production safety API й SW protocol не послаблено:

- dirty=unknown; missing API fail-closed; active stroke/export/import/Bake/playback (включно paused) не перериваються;
- ALLOW лише exact complete waiting release, recheck власної busy state, sessionStorage one-shot marker;
- no claim / no unconditional skipWaiting; ACK не controllerchange; один verified reload тільки requesting tab;
- same-scope uncontrolled включені в notification count; BroadcastChannel/CLIENTS не lock/quorum;
- frozen, nonconsenting і applying-window old tabs не forced reload; old hash bytes лишаються;
- embedded UI exclusion і genuine-beforeinstallprompt gate збережені. Synthetic native install proof не додано.

Physics, palettes, vendor, worker implementation, phase-8 cap/cleanup/rollback, offline demos — поза scope.

## Виконувана перевірка

З `D:/work/fluid-paint/fluid-paint`:

```sh
node debug/pwa-phase7a-eval.js
```

Runner створює isolated source у external Temp, junction до наявних node_modules та **окремий isolated Git index без commit** для existing fixture copy. Root dist/index не змінює; retained server не зупиняє. Retained `127.0.0.1:3000` має бути доступним для before/after exact readback.

Final evidence `$E`:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-azLg6U`.

`$E/result.json` — status PASS, exitCode 0; **13 top-level commands exit 0**. Exact executable/args/cwd/env/stdout/stderr — у цьому JSON. Не сума test cases.

Focused guards, окремо passed/failed:

- build PASS;
- activation **12/0**;
- detection **15/0**;
- readiness **11/0**;
- worker **12/0**;
- новий UX guard **4/0**.

Browser suites окремо:

- production **10/0**: development exclusion, WebGL1/2 offline draw/resize/Bake/PNG/import/bounded completed playback, failed installs, embedded wrong-origin/window security, natural activation;
- readiness **13/0**: uncontrolled не ready, pinned identity, cache/site wipe, cold offline, keyboard, embedded exclusion, install fallback та iPhone-UA instructions;
- detection **7/0**: actual V2 waiting, Later, waiting-at-bootstrap, 320px, offline failure без no-update claim;
- activation **14/0**: actual builds на одному origin, unknown/cancel, held pointer, actual encoder failure/in-flight export, actual Bake/import/playback busy gates, separate downloaded-file confirmation, frozen/nonconsenting/race tabs, old hashes, own once-only reload, cold offline, independent explicit discard;
- додаткова UI matrix: **2 viewport records** у activation result (`ux`); це не додаткові 14 activation cases.

Chromium **153.0.8010.12**, SwiftShader. Actual activation URL:
`http://127.0.0.1:61427/?webgl=2&debug=none&diag=0&seed=41` — **вже закритий**, не live review stand.

Actual identities:

- V1 `5428e7edb05515295651bd02da1b719608c462cbc1bd40e0851cbb1cc142d47d`;
- V2 `f5d043e1294ea2a07d4d7f70a88360b397a770c570ac8c1293b177b5b6e613f8`.

Frozen `activation-browser/v1`, `v2`, modified V2 fixture/source, persistent profiles, cache inventories, HTTP/server/browser logs, HAR і traces — у `$E`. V2 title/accessible label fixture змінюється лише для перевірки content identity, не engine.

### Geometry і UI evidence

`$R = $E/activation-browser`:

- `ux-1000-collapsed.png`, `ux-320-collapsed.png`: 49px, без IDs/paragraph warning у collapsed row;
- `ux-1000-actions.png`, `ux-320-actions.png`: icon controls, keyboard focus;
- `ux-1000-details.png`, `ux-320-details.png`: Enter на secondary summary, IDs/timestamps;
- `ux-1000-install.png`, `ux-320-install.png`: readable browser-menu fallback;
- `dirty-consent.png`, `ux-320-consent.png`: English loss consent і separate discard/cancel;
- `png-error-no-activation.png`, `ux-320-error.png`: стійкий live error, без activation;
- `export-awaiting-separate-confirmation.png`, `ux-320-file-confirmation.png`: друга явна дія після file check;
- `confirmed-artwork.png`: actual download, **180×130, 20483 bytes**, signature/dimensions/nonempty перевірені; download.failure=null;
- `v2-requesting-tab-verified.png`, `nonconsenting-old-tab-after-activation.png`, `new-tab-during-apply-old-shell.png`, `persistent-cold-v2.png`, `explicit-discard-v2.png`: retained matrix;
- `$E/readiness-browser/ios-ua-instructions.png`: реальний Chromium UA preview, **не Safari**.

UI JSON `ux[].open/expanded/collapsed` зберігає dock/canvas/control rectangles. At 320×900: collapsed y=851/h=49, details y=446/h=454, canvas bottom=446; File/Player/State tabs bottom=59. At 1000×900: details y=495.03125, canvas bottom=495.03125, tabs bottom=63.1875. Horizontal overflow=false в обох. Контракт — PWA не перекриває їх, а не виправлення існуючого взаємного накладання mobile Story/main panels. Long disclosure scroll не забирає touch input canvas.

Скріншоти 320 consent/error/install і desktop collapsed переглянуто візуально: English copy/кнопки читабельні, технічні IDs відокремлені. PNG/JSON — цифрові докази, не owner acceptance. Native install event у final **не запропоновано**, `nativePromptOffered=false`; native prompt acceptance NOT TESTED.

## Retained stand і cleanup

`http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41` збережено без rebuild/stop. Fresh exact listener readback: node.exe **PID31212**, parent **70768**, command `node_modules/gulp/bin/gulp.js startServer`.
Root inventory і `/sw.js` unchanged; before/after HTTP readback усіх **19 inventory assets + SW** HTTP200/SHA-exact. Retained release залишається
`4e6ce90e534c2b1929546a183156178cf28eb3571815375bfcf3d4ddbd996eb2` — **старий phase-7 UX**, не новий 7A live stand.

Own final ports **53150, 59833, 56429, 62631, 61427**: кожен runner stopped/bind-back; independent final bind-back усіх п’яти PASS. Chromium closures `browserDisconnected=true`; activation profile має 4 tabs, cold/discard по 1, усі закрито. Чужі процеси не зупиняли. Це exact owned cleanup, не global free-port claim і не скасування historical phase-7 EACCES/51333 limitation.

## Проміжні спроби та знайдений race у probe

- `fluid-pwa-phase7a-u8zMNL`: перший focused UX/activation/readiness/detection PASS; не final, бо пізніше додано Cancel focus, install screenshots і production regression.
- `fluid-pwa-phase7a-Ef1d43`: guards PASS, production browser FAIL після 7 cases: final cold start побачив іншу release identity. Probe знімала negative fixture (`negative=null`) при відновленні мережі, поки startup/online detection ще могла завантажити справжню V2/V3. Це fixture teardown race, не дозволений update/reload: браузер потім природно активував уже successful waiting після закриття всіх clients.
- Виправлено лише порядок fixture: дочекатися offline detector settle, повернути served V1 **до reconnect**, потім прибрати negative. Залишено всі exact redundant/no-waiting/V1 cache assertions; natural-activation/actual V2 cases не видалено. Final повний rerun `$E` PASS усіх перелічених suites/probes. Невдала спроба не порахована як PASS; її servers/browser cleanup записано в result.

## Змінені repository paths

- `app/layout.css`;
- `app/pwa-register.js`;
- `debug/pwa-activation-browser-test.js`;
- `debug/pwa-detection-browser-test.js`;
- `debug/pwa-detection-test.js`;
- `debug/pwa-readiness-browser-test.js`;
- `debug/pwa-worker-browser-test.js`;
- `debug/pwa-phase7a-eval.js` (новий isolated runner);
- `debug/pwa-ux-browser-checks.js` (нові actual UI assertions/screenshots);
- `debug/pwa-ux-test.js` (новий guard);
- `docs/spec/fluid-pwa/HANDOFF.md`;
- `docs/spec/fluid-pwa/QA.md` (QA-7AUX-1–8, historical QA-7A не перенумеровано);
- `docs/spec/fluid-pwa/PHASE7-REPORT.md` (лише current-vs-historical note);
- `docs/spec/fluid-pwa/PHASE7A-REPORT.md` (цей звіт).

Generated dist/evidence не додаються до repo. Root index не staged; HEAD не змінено. Commit/production deploy та owner acceptance — відсутні; draft deploy виконано вище.

## Незалежний post-document readback

```sh
node C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7a-azLg6U/verify-evidence.js
```

**PASS/exit 0**; `$E/post-document-verification.json`: 13 exact command codes/logs,
10 current implementation/test source files byte-identical frozen source,
**93 media artifacts** (PNG signatures, ZIP signatures, HAR JSON), 8 ordered
QA-7AUX IDs, relative document links, 2 viewport geometry records, 5 own ports
bind-back PASS. Exact profile/command process readback для final і двох попередніх
спроб не виявив own node/Chromium leftovers; retained PID31212/listener3000 та
19 assets+SW HTTP/SHA повторно перевірено. HEAD `34228fe` (prefix), root index
порожній, `git diff --check` PASS. Це author verification, parent/owner review ще не виконано.

## Незалежна parent-перевірка

Parent повторно виконав `verify-evidence.js`: PASS/exit 0, 13 command records,
10 frozen-source comparisons, 93 media artifacts, 8 QA IDs, усі 5 exact own
ports bindable; retained PID31212 підтверджено. `git diff --check` PASS.
Окремо повторено guards activation 12/0, detection 15/0, readiness 11/0,
worker 12/0, UX 4/0; browser suites повторно не запускались.
Візуально переглянуто `ux-320-consent.png` та `ux-1000-collapsed.png`:
loss warning/discard/cancel читабельні, collapsed dock відокремлено від canvas.
Це parent verification, не owner acceptance. Новий 7A live stand не залишено;
retained localhost:3000 досі показує phase-7 UX.

## NOT TESTED / збережений борг

Physical Android/iOS, real Safari/A2HS/standalone, native GPU/OS reboot, native install dialog, real mobile suspended lifecycle/15-minute wall-clock, browser quota/automatic eviction/MIME/hash fault injection, full великої story playback, external demo-CDN headers/CORS/downloads — **NOT TESTED**. Live Netlify shell headers та canonical full verify equivalent перевірено у draft section вище. Optional Demo index у screenshot може показувати fetch failure (не shell dependency); 7A не виправляє CDN allowlist. Historical phase-7 cleanup-readback EACCES не приховано й не перетворено на новий PASS.

Unknown dirty лишається свідомою безпечною межею; PNG не checkpoint. Висота 320px — desktop viewport, не фізичний телефон. Screen-reader voice output та physical touch не перевірені: підтверджено DOM live semantics/keyboard/focus, не AT certification. Review evidence у Temp локальне, не published stand. Фази 8–10 не реалізовані.

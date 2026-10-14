# QA: Fluid PWA

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

## Фаза 3 — persistent SW harness (2026-10-14, прийнята)

**Прийнято власником через `handoff:next` 2026-10-14, закрито.** Deploy не виконано. Це викидна fixture, не production SW/app.
Усі QA-3A–3G покриті real Playwright eval; людина перевіряє читабельність
скриншотів і межі результату. [Компактний звіт](./PHASE3-REPORT.md).

### Запуск фази 3

Попередній ручний Gulp server має бути зупинений. Порт 3000 не займати чужим
процесом; якщо зайнятий, вибрати інший **однаковий для обох commands**.
Інтернет не потрібний за наявності Playwright/Chromium; це localhost secure
context. Evidence та profile — лише дочірні каталоги `os.tmpdir()`, не repo.
`--review` відкриває справжній headed Chromium і сам закриває його після тесту;
сервер не лишається для ручних кліків. Стала сторінка review — real PNG files.

З кореня repo, Git Bash, один термінал; `PWA_PHASE3` лишити в цьому shell:

```sh
PWA_PHASE3="$(node -e 'const fs=require("fs"),os=require("os"),path=require("path");console.log(fs.mkdtempSync(path.join(os.tmpdir(),"fluid-pwa-phase3-review-")))')"
npm run build
npm run test:pwa-sw -- --port 3000 --profile "$PWA_PHASE3/profile" --evidence "$PWA_PHASE3/guard-selftest"
npm run pwa:sw:review -- --port 3000 --profile "$PWA_PHASE3/profile" --evidence "$PWA_PHASE3/probe-resume-review" --resume
npm run test:pwa-assets
```

Перший command створює fixture v1, другий **окремий Node process** бачить її
v2/cache без registration і переходить до v3. Повторний review на цьому
профілі запускати тільки з `--resume` і новим `--evidence`; не видаляти кеші
для «зеленого» результату. `--resume` без валідного marker чи зі зміненим port
відхиляється. Default `npm run test:pwa-sw:browser` має власний новий profile
і dynamic port. Для швидкого selftest можна запускати без headed review.
Якщо shell npm wrapper не працює, exact Node entrypoint цього checkout:
`node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'` замість `npm`.
Саме через цей npm entrypoint виконано всі scripts у final eval.

Історичні окремі результати реалізації: build PASS; guards **5/0**, browser selftest **8/0**;
separate-process resume probe **8/0**; retained assets **7/0**. Не сумувати suites.
Chromium 153.0.8010.12, Node 24.19.0. Обидва server stop/bind-back PASS,
0 page errors; negative timeout 250ms фактично 260ms/266ms у final pair.

Evidence root поточного eval:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-final-JSzEQD/`.
Тут `result.json` із exact commands/exit codes та stdout/stderr logs;
`guard-selftest/result.json`, `probe-resume-review/result.json`,
`verified-summary.json`, `independent-bind-back.json`. У кожному browser
підкаталозі 4 PNG, 4 traces, 4 HAR, `server.json`, `browser.json`.
Разом pair має 8 PNG / 8 traces / 8 HAR. Шляхи нижче з `$PWA_PHASE3` — для
вашого нового запуску; для вже виконаного eval замінити його цим root.

Parent незалежно повторив guard **5/0**, два browser invocations **8/0 кожен**
і retained assets **7/0** на новому shared profile/origin port 62805.
Додаткове evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-parent-9JsNbW/`
(`verification.json`, `first/result.json`, `resume/result.json`, logs/PNG/trace/HAR).
Cleanup/bind-back PASS; screenshot waiting v2/v3 переглянуто parent.
Це повторне підтвердження, не додатковий унікальний test count.

### QA-3A. Guard і disposable control

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`; fixture URL під час runner — `http://127.0.0.1:3000/__pwa_fixture/`.
**qa:action:** виконати build та перший `npm run test:pwa-sw -- …` із recipe вище, на новому profile.
**qa:inspect:** stdout та `$PWA_PHASE3/guard-selftest/run1-online.png`; поля `runs[0].state`, `runs[0].active` у `result.json`.
**qa:expected:** Node guards 5 passed/0 failed; browser cases=8, status=PASS, exitCode=0; active.version=`v1`, state.active=`activated`, controller=`http://127.0.0.1:3000/sw.js`, scope=`http://127.0.0.1:3000/__pwa_fixture/`, updateViaCache=`none`. PNG показує «Fluid PWA phase 3 — fixture only», не painting app. Покрито пробою.

### QA-3B. Другий Node process бачить попередній profile

**qa:mode:** cli
**qa:open:** той самий термінал, `PWA_PHASE3` і profile після QA-3A.
**qa:action:** виконати `npm run pwa:sw:review -- … --resume` із recipe, не очищати site data/profile.
**qa:inspect:** `$PWA_PHASE3/probe-resume-review/result.json`, `persistedFromPreviousInvocation` та `run1-online.png`.
**qa:expected:** 8 cases PASS; resume=true, baseline=`v2`; до registration controller уже існує, active=`v2`, два caches/four entries byte-for-byte дорівнюють final cold snapshot QA-3A. Profile і origin ті самі; це не чистий профіль. Після probe збережено v3, три fixture caches/six entries. Покрито separate-process probe.

### QA-3C. Offline cold navigation після повного закриття

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/run1-cold-offline.png` та `run2-cold-offline.png`; underlying URLs — `http://127.0.0.1:3000/__pwa_fixture/?cold=run1-cold-offline` і `http://127.0.0.1:3000/__pwa_fixture/?cold=run2-cold-offline`.
**qa:action:** відкрити обидва real PNG, прочитати `coldStarts` і `cleanup.contextClosures` у result того самого runner.
**qa:inspect:** стале `offline: true`, active version, cached-byte текст, fromServiceWorker і browserDisconnected у JSON.
**qa:expected:** два coldStarts; offlineBeforeNavigation=true до першого navigation; response HTTP 200/fromServiceWorker=true; byte рівно `fluid-pwa-phase3-cached-byte\n` (29 bytes, SHA у звіті); versions v1/v2, усі попередні contexts мають browserDisconnected=true і закриті tabs. Не лише reload/live offline toggle. Покрито пробою; OS reboot не заявляється.

### QA-3D. Active/waiting request-ID protocol

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/run2-waiting.png`, відповідний result.json.
**qa:action:** відкрити PNG, знайти case `active v1 / waiting v2 request IDs ignore unrelated replies`.
**qa:inspect:** `states.active`, `states.waiting`, два `replies` з target/version/requestId; у headed probe аналогічно v2/v3.
**qa:expected:** active=`activated`, waiting=`installed`; active reply v1, waiting reply v2, різні UUID і elapsedMs<2000; injected unrelated request-ID reply `WRONG` не прийнято. Fixture не робить skipWaiting/clients.claim; після close natural activation. Покрито concurrent real MessageChannel requests.

### QA-3E. Негативний bounded timeout

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/result.json` і `run2-waiting.png`.
**qa:action:** знайти `negativeTimeout` і наступний `protocol` STATUS reply для waiting worker.
**qa:inspect:** expectedFailure, timeoutMs, elapsedMs, error і наступна version.
**qa:expected:** IGNORE не відповідає: expectedFailure=true, timeoutMs=250, error містить `SW_REQUEST_TIMEOUT waiting IGNORE` та UUID; 200≤elapsedMs<3000 (final eval 260ms). Наступний STATUS v2 успішний; тест PASS саме за очікувану відмову, не замаскований network failure. Покрито пробою.

### QA-3F. Cache bytes і production-like headers

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/result.json` і `server.json`.
**qa:action:** прочитати `http`, `coldStarts[1].caches`, logs 404; виконати `npm run test:pwa-assets` з recipe.
**qa:inspect:** 19 inventory responses і 3 SW/metadata responses; byte entry URL/status/MIME/size/SHA; retained guard summary.
**qa:expected:** усі 19 production entries status=200, hashVerified=true і правильний MIME; hash-named assets immutable, HTML no-cache; `/sw.js`, `/release.json`, `/precache-inventory.json` no-store. Unknown JS має 404, не HTML fallback. Cache byte status=200, text/plain, 29 bytes, SHA `fdcb9c1acae2c9c5d0d836c55057415afdbc0b731f94f5a1e69dbf0cce8bf237`; retained assets 7/0 і production `dist/sw.js` відсутній. 405 перевіряє Node server guard, не browser log. Покрито guard+probe.

### QA-3G. Cleanup та bind-back

**qa:mode:** cli
**qa:open:** термінал у корені repo після обох runners; їхні result.json.
**qa:action:** виконати `node -e 'require("./debug/pwa-sw-harness").bindBack(3000).then(()=>console.log("portFree=true"))'`.
**qa:inspect:** stdout/exit code, `cleanup` у двох result.json; профіль лишається зовні, servers не відповідають.
**qa:expected:** stdout `portFree=true`, exit 0; serverStopped=true/portFree=true, contextsClosed=4 у кожному invocation, кожен browserDisconnected=true. Чужі процеси не зупиняти; fixture server не залишено. Команду й independent bind-back виконано до review.

## Фаза 2 — release identity та hashed assets (2026-10-14, прийнята)

Історичний eval реалізації: build PASS; guard: release **4/0**, phase-1 assets **7/0**, shader bundle
compatibility **25/0**. Probe: **2 WebGL cases PASS**, Chromium 153.0.8010.12 /
SwiftShader, два builds з однаковим releaseId, 19 inventory HTTP 200 + SHA-256
readback, hashed 404=0, shader XHR=0, page/GL errors=0. Phase-1 regression:
**2 viewport PASS** (1280×900, 320×900), 9 faces loaded на кожному, MIME/manifest.
Full `make verify` не запускався; числа різних рівнів не підсумовуються.

Evidence:
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase2-RREa45/result.json`
  (HAR, trace, server/two-build logs, metadata/inventory snapshots, 12 screenshots
  та 2 справжні PNG exports поруч).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791976458083-44816/result.json`
  (fresh phase-1 compatibility, HAR/trace/6 screenshots).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-guard-ONChpQ/result.json`
  (окремі build/guard logs і точні Node commands).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-change-xYWmvD/result.json`
  (змінений title у isolated fixture змінює releaseId, main checkout untouched).

Власні servers завершені, обидва останні runs port=3000 / portFree=true.
Review stand **не залишений**: запустіть свою команду вище. QA-2B–2G виконуються
послідовно в одній вкладці, повторити для `webgl=1` і `webgl=2`. Recipe обмежує
GPU allocations як існуючі Paint probes; це не новий production preset.

### QA-2A. Детермінізм, inventory та stale outputs

**Відкрити:** термінал у `D:/work/fluid-paint/fluid-paint`, сервер зупинений.
**Клікнути:** нічого; виконати `NODE_ENV=production node --test debug/pwa-release-test.js`, потім `npm run test:pwa-assets`.
**Дивитись:** test summary; `dist/release.json` і `dist/precache-inventory.json`.
**Очікуваний результат:** release 4 passed/0 failed, assets 7 passed/0 failed; обидва JSON мають однаковий 64-hex releaseId. Два real builds byte-identical за inventory; stale file/directory прибрані, changed HTML змінює identity; усі shell references resolve. Required inventory = 19 entries, без shader/SW/metadata; імена JS/CSS/WOFF2/PNG/manifest містять content SHA-256. Команди виконано до review; encoded contract — HANDOFF «Canonical encoding v1».

### QA-2B. Малювання на hashed production bundle

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, viewport 960×720; для повтору `http://127.0.0.1:3000/?webgl=1&debug=none&diag=0&seed=41`.
**Клікнути:** у Console виконати recipe нижче; потім провести лівою кнопкою з (504,305) до (576,305) всередині білого полотна.
**Дивитись:** біле полотно посередині, синій мазок; Network JS/CSS URLs.
**Очікуваний результат:** 180×130 полотно з видимою синьою фарбою; JS/CSS hash-named, HTTP 200, без shader XHR/404/page errors. Покрито actual Playwright mouse events + GPU materialMagnitude>0; не фізичний GPU QA. Recipe виконано у браузері:

```js
const p=window.__painter;p.paintingRectangle.left=450;p.paintingRectangle.bottom=350;p.paintingRectangle.width=180;p.paintingRectangle.height=130;p.engine.resizePainting(p.getPaintingResolutionWidth(),p.getPaintingResolutionHeight(),0,0);p.setPaintColor('#3B82F6');p.needsRedraw=true;
```

### QA-2C. Painting resize та viewport resize

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, продовжити QA-2B (повтор з `webgl=1`).
**Клікнути:** у Console виконати блок нижче; змінити DevTools viewport із 960×720 на 1000×740.
**Дивитись:** розмір білого полотна та збережений синій мазок; Console result.
**Очікуваний результат:** width=196, height=142, previewError=0, commitError=0; canvas й мазок не пропадають при viewport resize. Покрито probe через existing preview/commit API + реальний viewport resize; edge drag цим сценарієм не заявляється. Виконаний блок:

```js
(()=>{const p=window.__painter;p.newPaintingRectangle=p.paintingRectangle.clone();p.newPaintingRectangle.width+=16;p.newPaintingRectangle.height+=12;p.resizingSide=ResizingSide.TOP_RIGHT;p.interactionState=InteractionMode.RESIZING;p.needsRedraw=true;p.update();const previewError=p.wgl.gl.getError();p.interactionState=InteractionMode.NONE;p._commitResize();p.needsRedraw=true;p.update();return {width:p.paintingRectangle.width,height:p.paintingRectangle.height,previewError,commitError:p.wgl.gl.getError()};})()
```

### QA-2D. Bake не губить rendered artwork

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41` (продовжити QA-2C; повтор з `webgl=1`).
**Клікнути:** `#panel-grip` → `#panel-extension-toggle` (+) → State (`#bake-tab`) → `#bake-button`; після появи статусу закрити extension `#panel-extension-toggle` і згорнути панель `#panel-grip`.
**Дивитись:** `#bake-status`, Undo/Redo та artwork після згортання панелей.
**Очікуваний результат:** стійкий текст «Baked. Wet paint and Undo history were reset.»; Undo/Redo disabled, artwork збережено. Probe додатково asserted rendered max delta=0, wet magnitude=0, hasBackground=true; screenshots `webgl*-bake.png` (UI) і `webgl*-baked-artwork.png` (art). Покрито реальним Bake DOM click, не mock.

### QA-2E. Справжній PNG download

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка після QA-2D (повтор з `webgl=1`).
**Клікнути:** `#panel-grip` → Save As… (`#save-button`); зберегти PNG.
**Дивитись:** завантажений PNG у image viewer.
**Очікуваний результат:** PNG 196×142 містить синій artwork, не порожній output. Probe реально отримав download і зберіг `webgl1-export.png`/`webgl2-export.png`, перевірив PNG signature/dimensions/download.failure=null. Це flattened PNG, не checkpoint wet state/Undo.

### QA-2F. Локальний PNG import

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка QA-2E (повтор з `webgl=1`).
**Клікнути:** + (`#panel-extension-toggle`) → File (`#story-file-tab`) → Choose file; `#story-file-input`, вибрати PNG, збережений у QA-2E (автопроба використовує свої `webgl*-export.png`).
**Дивитись:** background card `#story-background-name` і artwork.
**Очікуваний результат:** card показує вибраний filename; renderer.hasBackground=true; summary sourceWidth=196, sourceHeight=142, PNG стає background. Покрито справжнім local file-input, screenshot `webgl*-import.png`.

### QA-2G. Локальний story JSON import

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка QA-2F (повтор з `webgl=1`).
**Клікнути:** File → Choose file (`#story-file-input`), вибрати `D:/work/fluid-paint/fluid-paint/docs/story-2026-09-08-4-frames.json`.
**Дивитись:** Player, `#story-player-file-name`, кнопки story controls.
**Очікуваний результат:** автоматично відкрито Player; filename `story-2026-09-08-4-frames.json`, controller.state=`ready`, без page errors. Retained fixture доступний у checkout; import покрито probe, playback не acceptance фази 2.

## Фаза 1 — локальні assets (2026-10-14, прийнята)

Історичний eval реалізації: build PASS; guard **7 passed / 0 failed**; браузерна проба
**2 viewport PASS** (1280×900 і 320×900), Chromium 153.0.8010.12 / SwiftShader.
Це окремі рівні, не «9 тестів». На кожному viewport завантажено 9 локальних
font faces (3 subsets × 3 weights), manifest має 0 parse errors, page errors = 0.
Google font requests = 0; невдалих same-origin assets = 0. Іконки декодовані
як 192/512 any, 192/512 maskable і 180 apple touch. HTTP MIME перевірено для
webmanifest/png/svg/woff2; SVG — тимчасовий probe-файл, прибраний після запуску.

Докази остаточного запуску:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791974679450-60396/`:
`result.json`, `network.har`, `trace.zip`, `server.log`,
`1280-panel.png`, `1280-file.png`, `1280-state.png`,
`320-panel.png`, `320-file.png`, `320-state.png`.
Порт 3000 звільнений пробою та незалежно повторно перевірений bind-операцією.
Попередні scratch/failed runs у Temp — не acceptance evidence.

### QA-1A. Desktop: панель і слайдер

**Відкрити:** `http://127.0.0.1:3000/`, viewport 1280×900.
**Клікнути:** grip `#panel-grip`; `#fluidity-slider` приблизно на 70% ширини.
**Дивитись:** основна панель, назви Paint Fluidity / Bristle Count / Brush Size, повзунок Fluidity.
**Очікуваний результат:** панель розгорнута, три слайдери видимі, повзунок переходить до місця кліку; панель і тексти не обрізані. Покрито браузерною пробою; пропорції перевірити очима.

### QA-1B. Mobile: панель і слайдер

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці, DevTools viewport 320×900.
**Клікнути:** `#panel-grip`; `#fluidity-slider` приблизно на 70% ширини.
**Дивитись:** панель від x=12 до x=308, підписи, слайдери та нижні Clear / Save As… .
**Очікуваний результат:** ширина панелі 296px, усі основні controls у viewport, назви читабельні, повзунок реагує. Покрито пробою; не є фізичним mobile QA.

### QA-1C. Story File controls

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на 1280×900 і 320×900.
**Клікнути:** `#panel-grip` → `#panel-extension-toggle` (+) → вкладка File (`#story-file-tab`).
**Дивитись:** вкладки Demo / File / Player / State та dropzone `#story-file-dropzone`.
**Очікуваний результат:** File selected; видно «Drop Story JSON or PNG», «or choose a local file», «.json / .png · max 25 MB» без обрізання. На 320px extension накладається на основну панель — чинна поведінка, не новий dock. Покрито пробою; сам імпорт у цій фазі не перевіряється.

### QA-1D. Story Player empty state

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на обох viewport.
**Клікнути:** `#panel-grip` → + → File → Player (`#story-player-tab`).
**Дивитись:** `#story-player-empty` і кнопку Choose file.
**Очікуваний результат:** видно «No story loaded» та «Load a Tilecraft JSON file to enable playback.»; Player відображається без завантаженої story. Покрито пробою; playback не заявляється як перевірений.

### QA-1E. State controls

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на обох viewport.
**Клікнути:** `#panel-grip` → + → File → Player → State (`#bake-tab`); Bake не натискати.
**Дивитись:** Brush Angle, пояснення Bake та `#bake-button`.
**Очікуваний результат:** тексти й зелена кнопка «Bake» всередині viewport; Brush Angle disabled для Round. Покрито пробою; сам Bake не входить у цей probe.

### QA-1F. Fonts локальні, без Google

**Відкрити:** `http://127.0.0.1:3000/` із Network → Disable cache, після Reload.
**Клікнути:** `#panel-grip`; у Console виконати ``for (const weight of [400,600,700]) await document.fonts.load(`${weight} 14px "Open Sans"`, 'Paint Fluidity Ї Є Ґ Ł'); await document.fonts.ready;``.
**Дивитись:** Network filter `woff2`; окремо filter `googleapis` та `gstatic`; Console `Array.from(document.fonts).map(f => ({family:f.family,weight:f.weight,status:f.status}))`.
**Очікуваний результат:** дев'ять Open Sans normal faces 400/600/700 loaded; WOFF2 із `/assets/fonts/open-sans/`; 0 запитів до fonts.googleapis.com/fonts.gstatic.com. Latin/Latin-ext/Cyrillic завантажуються локально, не fallback. Покрито пробою через FontFaceSet та HAR.

### QA-1G. Manifest та іконки

**Відкрити:** `http://127.0.0.1:3000/`, DevTools → Application → Manifest.
**Клікнути:** нічого; переглянути manifest та previews іконок.
**Дивитись:** name/short_name, id, start URL, scope, display, чотири icon previews; apple tag у Elements.
**Очікуваний результат:** Fluid Paint; id/start_url/scope `/`; standalone; theme/background `#202024`; PNG 192/512 any і 192/512 maskable; apple 180×180. 0 manifest parse errors (CDP `Page.getAppManifest`), усі п'ять PNG декодуються. Install/offline warnings без SW у фазі 1 не є parse failures. Парсинг/декодування покрито пробою, UI DevTools перевіряє людина.

### QA-1H. MIME та cleanup

**Відкрити:** термінал у `D:/work/fluid-paint/fluid-paint`, після зупинки ручного сервера.
**Клікнути:** нічого; виконати `PWA_QA_PORT=3000 npm run test:pwa-assets:browser`.
**Дивитись:** підсумок у терміналі та `mime` у надрукованому каталозі `result.json`.
**Очікуваний результат:** PASS, pages=2, googleFontRequests=0, port=3000, portFree=true; HTTP 200 з `application/manifest+json`, `image/png`, `image/svg+xml`, `font/woff2`; власний сервер не лишається працювати. Команду виконано до review.

## Межі й не перевірене

- Фаза 2 додає hashed assets та precache inventory, **не precache cache**.
  Фаза 3 доводить persistent SW harness/offline cold start тільки викидної
  fixture. Production SW/readiness, app offline cold start, install/update UX,
  hosting headers і deployment ще не реалізовані. Manifest/inventory — build
  groundwork, не app offline acceptance. Фаза 1 не додавала hashing (історичний факт).
- Android/iOS standalone, фізичні пристрої та production app offline cold start — NOT TESTED,
  це майбутні фази. Ширина 320px — desktop Chromium viewport, не телефон.
- Відкриття + ініціює чинний запит Demo index до CDN (2 запити у пробі).
  Це optional app data, не HTML/CSS/manifest dependency; CORS/demo playback
  та доступність зовнішнього каталогу не приймаються цією фазою.
- На mobile story panel накладається на основну й має прозорий фон; це чинний
  layout. Geometry і fonts перевірено, новий UX тут не реалізовано.
- Зовнішні footer anchors прибрані задля буквального guard «0 cross-origin
  HTML links»; attribution-текст незмінний, URLs збережені в assets/PROVENANCE.md.
- Icon master owner-directed; нової ліцензії на чужий арт не вигадано.

## Журнал фаз

- 2026-10-14 — фаза 3 **прийнята власником через `handoff:next` і закрита**.
  Код/документи входять у closing commit поверх `ff429d4`; deploy не виконано.
  Свіжий closing build PASS, harness guard 5/0, retained assets 7/0.
  Browser evidence вище повторно прочитано: історичні first/resume 8/0 кожен,
  проби не перезапускались. Port 3000 незалежно bind-back PASS.
  Межі NOT TESTED збережено. Далі фаза 4 після дозволу почати.

- 2026-10-14 — фаза 2 прийнята власником (`handoff:next`) і закрита.
  Closing build PASS; свіжі guards release 4/0, assets 7/0, shader 25/0
  через прямі Node entrypoints (npm shell invocation завершився timeout, не PASS).
  Browser результати нижче історичні; evidence PASS/exitCode=0/portFree=true
  повторно прочитано, без перезапуску проб. Межі NOT TESTED збережено.
  Guard 4/0 + regression assets 7/0 + shader 25/0; browser 2 WebGL cases PASS,
  phase-1 regression 2 viewport PASS. Evidence вище, servers cleaned up.
  Історичний next-work тоді: фаза 3; тепер вона також закрита.
  Фаза 2 включена в closing commit; production deploy не виконано.
- 2026-10-14 — фаза 1 прийнята власником (`handoff:next`) і закрита;
  closing build PASS, guard 7 passed / 0 failed. Browser evidence вище
  збережено; фізичні Android/iOS NOT TESTED. Deploy не виконано.
  Історичний next-work тоді: фаза 2; тепер 1–3 закриті, 4–10 не починались.

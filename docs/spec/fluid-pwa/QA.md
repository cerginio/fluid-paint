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
  SW, offline readiness/cold start, install/update UX, persistent SW harness,
  hosting headers і deployment ще не реалізовані. Manifest/inventory — build
  groundwork, не offline acceptance. Фаза 1 не додавала hashing (історичний факт).
- Android/iOS standalone, фізичні пристрої та offline cold start — NOT TESTED,
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

- 2026-10-14 — фаза 2 прийнята власником (`handoff:next`) і закрита.
  Closing build PASS; свіжі guards release 4/0, assets 7/0, shader 25/0
  через прямі Node entrypoints (npm shell invocation завершився timeout, не PASS).
  Browser результати нижче історичні; evidence PASS/exitCode=0/portFree=true
  повторно прочитано, без перезапуску проб. Межі NOT TESTED збережено.
  Guard 4/0 + regression assets 7/0 + shader 25/0; browser 2 WebGL cases PASS,
  phase-1 regression 2 viewport PASS. Evidence вище, servers cleaned up.
  Далі фаза 3 — SW harness spike після дозволу почати; фаза 3 не починалась.
  Фаза 2 включена в closing commit; production deploy не виконано.
- 2026-10-14 — фаза 1 прийнята власником (`handoff:next`) і закрита;
  closing build PASS, guard 7 passed / 0 failed. Browser evidence вище
  збережено; фізичні Android/iOS NOT TESTED. Deploy не виконано.
  Історичний next-work тоді: фаза 2; тепер вона закрита, 3–10 не починались.

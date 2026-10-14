# QA: fluid-2

Сценарії накопичувальні; нові фази додаються згори. Production Paint у B
використовує encoded RGB; старий контракт у секції A — історичний. Deploy не виконується.

## Локальний запуск і докази

Корінь: `D:/work/fluid-paint/fluid-paint`. Для ручного перегляду source-проби:
`npx --no-install http-server . -p 62865 -a 127.0.0.1 -c-1`.
Після перегляду зупинити Ctrl+C. Порт має бути вільним; чужі процеси не зупиняти.
Source-проба не потребує зовнішнього інтернету. GPU-тест сам піднімає source
server, запускає Chromium і закриває браузер/server; типово порт випадковий.
Для записаних нижче точних URL: `COLOR_PROBE_PORT=62865 npm run test:color-adapter:gpu`
(Git Bash; Windows cmd: `set COLOR_PROBE_PORT=62865&& npm run test:color-adapter:gpu`).

Фактичний фінальний GPU-run: `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-5trTfc/`.
У ньому `result.json`, чотири mode JSON, справжні PNG і smoke screenshots.
Stdout: `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-final-gpu.log`.
Це локальні тимчасові докази, не committed fixtures. Повторний запуск створює
власний temp-каталог. Після eval сервер зупинено, порт звільнено.
На цій машині 3000 повернув EACCES, 8087 зайнятий; чужий сервер не чіпали.

## Release / production QA — 2026-10-14

- Власник дозволив виправлення тесту та production deploy для QA.
- `debug/story-player-ui-test.js` звіряє engine/UI з `INITIAL_*` конфігом,
  без hardcoded brush size 12. Production default 32 уже в `c2a537d`.
- Повний npm-еквівалент `make verify` PASS, включно зі story UI та Bake;
  color 42/42, adapter 6/6, shader unit 25/25. Фінальний production build PASS.
- Netlify site `79a5d98c-0ff5-47fd-b048-64d714854ff9`;
  deploy `6acf2dc4387e01034f6d18d8`, production https://fluid.storytilecraft.space.
  Immutable URL: https://6acf2dc4387e01034f6d18d8--fluid-paint.netlify.app.
- Readback production index.html/bundle.js/app/layout.css: HTTP 200,
  побайтно рівні локальному verified dist. Browser smoke: engine ready,
  brush size 32, registry present, 0 shader requests, pageerrors [].
  Screenshot/result: `C:/Users/cergi/AppData/Local/Temp/fluid-prod-qa-vCqdcH/`.
- Це startup smoke на SwiftShader, не production draw/resize/Save або
  physical GPU PASS. Повні draw/resize/Save перевірки пройшли локально.
- Release follow-up прийнято власником через `handoff:next` 2026-10-14;
  A–C не перевідкривали. Closing rerun `npm run test:story-ui` PASS,
  `git diff --check` PASS. Повний gate і production smoke вище — результати
  перед deploy; зараз їх повторно не запускали. Retained coverage debt
  не перетворено на physical GPU або production draw/resize/Save PASS.

### QA-Release1. Production bundle і базові дії

**qa:open:** https://fluid.storytilecraft.space/?webgl=2&debug=none&diag=0&seed=41
**qa:action:** Network: вимкнути Preserve log, увімкнути Disable cache,
очистити список, reload. Намалювати мазок; змінити розмір полотна;
відкрити панель і Save As…; повторити з webgl=1.
**qa:inspect:** Network, полотно після resize, завантажений PNG.
**qa:expected:** bundle.js замість окремих source JS; 0 .frag/.vert requests;
brush size 32; матеріал видно після resize і в PNG; без init error.
Startup/WebGL2 перевірено на prod; решта дій — human QA, не заявлений prod PASS.

## Фаза C — прийнята й закрита (2026-10-14)

**Відтворення:** `npm run test:shader-bundle:gpu` у корені репозиторію.
Runner спочатку робить production build, запускає source server на випадковому
вільному порту, Chromium/SwiftShader, виконує всі browser сценарії C1…C12,
потім закриває browser і **лише власні** servers та перевіряє bind-back портів.
Зовнішній інтернет не потрібен. Dev-проба самостійно запускає справжній Gulp
serve з `PORT=0`; правки shader/manifest тимчасові, відновлюються у finally.
Не запускати цей watcher/probe одночасно з редагуванням тих самих файлів.

Для ручного source review — команда source server у преамбулі, замінити
записаний порт 51086 на власний 62865. Для bundle review — `PORT=62865 npm run dev`,
відкрити `http://127.0.0.1:62865/index.html?webgl=1&debug=none&diag=0&seed=41`
і повторити з `webgl=2`. `npm run dev` **не** роздає source examples.
Записані нижче URL реально відкриті runner, але серверів після eval не лишено.

Фінальні докази: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-gQmano/`:
`result.json`, `production-build.log`, `dev-watch.log`, справжні PNG, названі
нижче. У `result.json`: pass=true, source port 51086 і dev port 50095,
обидва cleanup.bindBack=true. Матеріал внесено через чинний engine Stroke API,
resize — через чинні Paint methods, Save — справжні UI clicks. Це не ручний
pointer або physical-GPU PASS; screenshots доповнюють числові checks.
GLSL source й production registry тексти рівні, keys рівні live manifests;
кількість 22 є спостереженням, не константою тесту.

CLI stdout/stderr/exit codes повного SDLC прогону:
`C:/Users/cergi/AppData/Local/Temp/fluid-2-C-finish/commands.json` і сусідні logs.
`final-verification.json` поруч: bind-back записаних C/A/B портів, збереження
HEAD, empty index, `git diff --check`, відсутність тимчасових watch правок.
16 виконань (15 різних команд, build двічі), усі exit 0. Make відсутній;
виконано npm-еквівалент актуального `make verify` плюс fluid-control.

Незалежне підтвердження батьківського агента: lint, unit 25/25,
`test:shader-bundle:gpu` та фінальний production build PASS.
Нові JSON/PNG: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-WscaUV/`;
screen і saved PNG переглянуто, синій матеріал видно. Порти 49271/52872
і попередні 50095/51086 вільні. Повний SDLC commands manifest та наявність
окремих stdout/stderr перевірено: 16 виконань / 15 команд, усі exit 0.

### QA-C1. Bundle малює без жодного shader request

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/dist/index.html?webgl=1&debug=none&diag=0&seed=41`,
потім та сама адреса з `webgl=2`.
**qa:action:** runner блокує всі `.frag`/`.vert` routes до навігації, вносить
мазок через `engine.beginStroke`/`endStroke`, викликає Paint update.
**qa:inspect:** `bundle-webgl1-screen.png`, `bundle-webgl2-screen.png`,
`result.json` → `bundle-WebGL1/2`.
**qa:expected:** синій матеріал на білому полотні; shaderRequests=0, errors=[],
фактичні webglVersion=1/2, materialDelta=1.3786293268203735 (>0).
manifestEqual=true і shaderTextExact=true. Покрито C GPU runner; не кешем.

### QA-C2. Resize preview й commit працюють в обох WebGL

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/dist/index.html?webgl=1&debug=none&diag=0&seed=41`
та `http://127.0.0.1:51086/dist/index.html?webgl=2&debug=none&diag=0&seed=41`.
**qa:action:** runner створює `newPaintingRectangle`, збільшує 180×130 до
196×142, задає TOP_RIGHT/RESIZING, виконує update й `_commitResize()`;
потім змінює viewport із 960×720 на 1000×740.
**qa:inspect:** `bundle-webgl1-resize.png`, `bundle-webgl2-resize.png`,
`result.json` → `resized`.
**qa:expected:** матеріал видно після resize; width=196, height=142,
glErrorPreview=0, glErrorCommitted=0; shader requests лишаються 0.

### QA-C3. Save As… завантажує справжній PNG

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/dist/index.html?webgl=1&debug=none&diag=0&seed=41`
та `http://127.0.0.1:51086/dist/index.html?webgl=2&debug=none&diag=0&seed=41`, після QA-C2.
**qa:action:** натиснути `#panel-grip`, потім `#save-button`; runner ловить
browser download і зберігає файл, а не імітує blob.
**qa:inspect:** `bundle-webgl1-save.png`, `bundle-webgl2-save.png`, `pngBytes` у JSON.
**qa:expected:** обидва файли — PNG по 5173 bytes, містять намальований
матеріал; console errors=[], shader requests=0. Покрито C GPU runner.

### QA-C4. Source Paint використовує файловий loader

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner вносить мазок через production Stroke API.
**qa:inspect:** `source-paint.png`, `result.json` → `source-paint`, Network.
**qa:expected:** матеріал видно, materialDelta=1.3415980339050293, errors=[],
22 файлові shader requests (поточний manifest), без реєстру bundle.

### QA-C5. Minimal source host лишається сумісним

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/examples/minimal/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner вносить `space:'pigment'` через engine Stroke API.
**qa:inspect:** `source-minimal.png`, `result.json` → `source-minimal`, `#status`.
**qa:expected:** engine малює, materialDelta>0, errors=[], 19 shader requests
(поточний engine manifest). App color policy або registry не потрібні.

### QA-C6. Неповний registry — явний init error без fallback

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/dist/index.html?debug=none&diag=0`.
**qa:action:** runner init-script перехоплює registry assignment і видаляє
`fluid-engine/shaders/splat.vert` до loadShaderTrees.
**qa:inspect:** `#shader-load-error`, `error-registry.png`, `result.json` → `error-registry`.
**qa:expected:** `Missing/empty bundled shader: fluid-engine/shaders/splat.vert`,
shaderRequests=0, pageErrors=[]; engine не створено. Не прихований XHR repair.

### QA-C7. Source HTTP 404 не стає GLSL

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/index.html?debug=none&diag=0`.
**qa:action:** runner повертає HTTP 404 HTML для `fluid-engine/shaders/splat.vert`.
**qa:inspect:** `#shader-load-error`, `error-http404.png`, `result.json` → `error-http404`.
**qa:expected:** `Shader load failed: fluid-engine/shaders/splat.vert: HTTP 404`;
engine не створено, pageErrors=[], жодної компіляції HTML.

### QA-C8. Source network error доставляється до UI

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/index.html?debug=none&diag=0`.
**qa:action:** runner route.abort('failed') для `fluid-engine/shaders/splat.vert`.
**qa:inspect:** `#shader-load-error`, `error-network.png`, JSON → `error-network`.
**qa:expected:** `Shader load failed: fluid-engine/shaders/splat.vert: network error`;
engine не створено, pageErrors=[], ініціалізація не зависає.

### QA-C9. HTML fallback з HTTP 200 теж відхиляється

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/index.html?debug=none&diag=0`.
**qa:action:** runner повертає status 200/content-type text/html для `splat.vert`.
**qa:inspect:** `error-html200.png`, `#shader-load-error`, JSON → `error-html200`.
**qa:expected:** `Shader load failed: fluid-engine/shaders/splat.vert: HTML response, expected shader text`;
engine не створено, pageErrors=[].

### QA-C10. Minimal показує помилку файлового loader

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:51086/examples/minimal/index.html?debug=none&diag=0`.
**qa:action:** runner повертає HTTP 404 для engine `splat.vert`.
**qa:inspect:** `#status`, `error-minimal404.png`, JSON → `error-minimal404`.
**qa:expected:** `Shader load failed: ../../fluid-engine/shaders/splat.vert: HTTP 404`;
minimal host/engine не створено, pageErrors=[].

### QA-C11. Справжній dev watch перебудовує shader text

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:50095/index.html?debug=none&diag=0&seed=41`
(цей dev stand запускає runner через gulp serve, NODE_ENV=development, PORT=0).
**qa:action:** runner тимчасово додає у `app/shaders/shadow.frag` comment
marker, чекає його в bundle, відновлює файл і чекає точної рівності bundle
початковому; після всіх watch checks відкриває сторінку й малює.
**qa:inspect:** `dev-watch.log`, JSON → `shaderWatch`/`dev`, `dev-bundle.png`.
**qa:expected:** bundleContainsMarker=true; dev materialDelta>0,
shaderRequests=0. Restored bundle exact=true, жодної постійної shader правки.

### QA-C12. Зміна manifest регенерує registry і bundle

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:50095/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner тимчасово додає наявний `shaders/picker.vert` у
APP_SHADERS в `common.js`, чекає `app/shaders/picker.vert` у generated registry
та bundle, відновлює common.js і чекає точної рівності початковому dev bundle.
**qa:inspect:** `dev-watch.log`, JSON → `manifestWatch` і `devRestoreBundleExact`.
**qa:expected:** bundleContainsKey=true, addedPhysicalKey=`app/shaders/picker.vert`,
devRestoreBundleExact=true; manifest/source відновлено, порти 50095/51086 вільні.

### QA-C13. Guard: build negatives та once-only loader

**qa:mode:** cli
**qa:open:** `D:/work/fluid-paint/fluid-paint`.
**qa:action:** `npm run test:shader-bundle`.
**qa:inspect:** Temp finish `05-test-shader-bundle.stdout.log`/`.stderr.log`;
actual Gulp fixtures: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-build-missing-G8z3Em/`,
`fluid-2-C-build-empty-JrEJhS/`, `fluid-2-C-build-collision-dsavOG/` у тому самому
Temp корені — кожен має stdout.log, stderr.log, result.json.
**qa:expected:** 25/25 PASS; actual missing/empty/collision gulp build exit
nonzero, точний шлях у error, bundle не створено. Unit підтверджують physical
і logical collision, exact source text, registry completeness/no fallback,
empty lists, повторні/late callbacks, 404/500/status0, blank/HTML, network,
abort/timeout. Browser 30-second timeout/abort окремо не відтворювали;
ці гілки покриті unit, не позначати browser PASS.

### QA-C14. Повний SDLC regression gate

**qa:mode:** cli
**qa:open:** корінь репозиторію.
**qa:action:** послідовно виконати `npm run lint:shaders`, `npm run test:color`,
`npm run test:color-adapter`, `npm run test:timing`, `npm run test:shader-bundle`,
`npm run test:tilecraft`, `npm run build`, `npm run test:shader-bundle:gpu`,
`npm run test:color-adapter:gpu`, `npm run test:paint-palette:gpu`,
`npm run test:live-gpu`, `npm run test:tilecraft:gpu`, `npm run test:story-ui`,
`npm run test:bake`, `npm run test:fluid-control`, `npm run build`.
**qa:inspect:** Temp finish `commands.json`, окремі stdout/stderr кожної команди.
**qa:expected:** 16 exit 0; color 42/42, adapter 6/6, shader 25/25; чинні
GPU/Bake/story/control regression PASS, фінальний dist — production build.
Не підсумовувати незалежні assertion scripts у вигаданий total tests.
Physical GPU/mobile visual acceptance з A/B лишаються coverage debt;
C прийнята власником через `handoff:next` 2026-10-14; deploy не виконано.

### Closing journal C — 2026-10-14

- Свіжі lint, shader unit 25/25, production build PASS. C browser/watch
  rerun PASS: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-EeUP4P/result.json`;
  WebGL1/2: 0 shader requests, resize GL errors 0, Save PNG 5173 bytes.
  Source/errors, shader/manifest watch, exact dev restore PASS. Cleanup
  63897/52845 bind-back PASS. Повний SDLC результат вище історичний.
- Перший closing attempt `fluid-2-C-5GcOoL` — timeout manifest bundle rebuild
  після registry rebuild; повтор без кодування PASS. Причину не встановлено;
  intermittent watch/probe failure лишається debt, не прихований PASS.
- Physical GPU/mobile та browser abort/timeout coverage debt збережено.
- Якщо сервер роздає корінь repo (команда у преамбулі), bundle review URL:
  `http://127.0.0.1:62865/dist/index.html?webgl=2&debug=none&diag=0&seed=41`;
  повторити з webgl=1. Для `npm run dev` dist уже є коренем, тому `/index.html`.
  Network після очищення та reload: bundle.js, без окремих source JS
  і без .frag/.vert requests. На сервері власника обидва HTML та bundle
  перевірено HTTP; root /index.html був source, /dist/index.html — bundle.

## Фаза B — прийнята й закрита 2026-10-13

**Відтворення:** у корені `npm run test:paint-palette:gpu`. Runner сам запускає
source server на вільному порту, Chromium/SwiftShader, усі наведені нижче
операції та справжні screenshots; закриває browser/server і перевіряє bind-back.
Фактичний URL цього прогону: `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
Це записана адреса, **не залишений сервер**. При повторі порт друкується у JSON.
Для власного ручного стенду використати незмінну команду source server вище;
її порт 62865 замінює записаний 52290 у URL. Зовнішній інтернет не потрібен.

Докази B: `C:/Users/cergi/AppData/Local/Temp/fluid-2-B-ZRvNIZ/`:
`result.json`, `paint-palette-main.png`, `paint-palette-active.png`,
`paint-palette-hex.png`, `paint-palette-story.png`, `minimal-legacy.png`,
`paint-export.png`. Логи та exit codes повного прогону; додатковий фінальний rerun із відкритою
Player-панеллю — `test-paint-palette-gpu-final.log` (exit 0). Усі інші команди:
`C:/Users/cergi/AppData/Local/Temp/fluid-2-B-finish/commands.json` і сусідні `.log`.
Browser-сценарії нижче виконано production methods/debug API, з реальними
UI clicks там, де селектори названі. Це не physical-device або ручний pointer PASS.
Скриншоти доповнюють числові probes, не замінюють human acceptance.

### QA-B1. Старий матеріал не перефарбовується

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner вносить мазок через `engine.beginStroke` з
`painter._strokeColor()`, викликає `setPaletteMode('digital')`, потім `'natural'`.
**qa:inspect:** `result.json` → `frozen`; окремо `active` для Natural/Digital/mixed.
**qa:expected:** frozen raw/export delta 0; кожен із трьох initial materials
також має frozen raw/export delta 0. Фіксований renderer RGB (`1`), палітра
змінюється без Clear/Bake/replay. Покрито `test:paint-palette:gpu`.

### QA-B2. Активна симуляція не залежить від палітри

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** `npm run test:paint-palette:gpu`; runner відновлює один initial
material snapshot, скидає dynamics і задає fixture velocity `[2,1]`; виконує
контрольний та switched run по 30 однакових steps без RAF між ними.
**qa:inspect:** `active` у JSON і `paint-palette-active.png`.
**qa:expected:** три пари Natural/Digital/mixed: raw/export delta 0,
`steps:30`, `movedRawDelta > 2`. Однаковий backend/precision, допуск 0.
Не використовувати знімки двох довільно синхронізованих live сторінок.

### QA-B3. Точний HEX, readout та обидва previews

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** `__painter.setPaintColor('#123456')`; відкрити панель `#panel-grip`;
клікнути `#models > div` з текстом Digital, потім Natural. Для alpha runner
виконує `__painter.colorControl.picker.color.alpha = .25`.
**qa:inspect:** `#paint-color-hex`, `#paint-color-alpha`; `uiApi.previews` і
`paint-palette-hex.png` (поточна Natural/RYB-палітра, не модель полотна).
**qa:expected:** HEX `#123456`, alpha `40` у обох палітрах. Production marker
та viewer draw arguments точно `[18/255,52/255,86/255]`, як `_paintRgb()`;
спільний adapter кодує їх `[1-g,1-r,1-b]`. Palette gradients не є exact HEX override.

### QA-B4. Endpoints/alpha зберігаються, H/S/V замінює вибір

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** клікнути `#paint-color-white`, потім `#paint-color-black`;
runner перевіряє обидва endpoints після palette switches/alpha.
Для HEX runner окремо задає `picker.color.hue=90`, `.saturation=60`, `.value=80`.
**qa:inspect:** readout і `endpoints`, `uiApi.hsvReplacement` у JSON.
**qa:expected:** White `#FFFFFF` / channels `[0,0,0]`, Black `#000000` /
channels `[1,1,1]`; alpha не змінює RGB. Кожна зміна H/S/V скидає exact override.

### QA-B5. Колір ручного мазка фіксований на початку

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner викликає ручний producer `_beginPaintStroke(1,'mouse')`
для `#123456`, потім змінює палітру/вибраний HEX на `#F97316` і викликає strokeTo.
**qa:inspect:** `uiApi.frozenStroke`, actual engine active stroke color.
**qa:expected:** active color лишається encoded `#123456`; наступний payload
бере новий вибір. Перевірено manual producer, не synthetic pointer gesture.

### QA-B6. Перекриття, Undo/Redo і resize

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner зберігає pre-stroke snapshot, додає overlapping Digital
мазок, перемикає Natural, виконує `undo()`, `redo()`, resize preview та `_commitResize()`.
**qa:inspect:** `history` і `historyResize` у JSON.
**qa:expected:** overlap material delta >0; undo/redo delta 0 щодо відповідних
станів; palette зберігає snapshot index. Resize preview `{model:1,resizing:true}`;
після resize raw/export delta від palette switch 0.

### QA-B7. PNG-фон, export і Bake не залежать від палітри

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner генерує green/white PNG File, завантажує через
`loadBackgroundImage`, перемикає палітру, виконує `bakeToBackground()` і
`exportPngBlob()` до/після наступного перемикання.
**qa:inspect:** `backgroundBake`, `png`, `paint-palette-main.png`, `paint-export.png`.
**qa:expected:** background switch delta 0, Bake rendered delta 0, wet
materialMagnitude 0, hasBackground true. PNG blobs ідентичні; MIME image/png,
експорт використовує RGB (`models:[1,1]`). Natural mixing не є старим pigment mixing.

### QA-B8. Story HEX, restart/replay та control API

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:52290/index.html?debug=none&diag=0&seed=41`.
**qa:action:** runner створює `FluidControlApi` у `fluid-rescript`, активує
transfer і виконує `setPaintColor` для HEX/White/Black. Окремо завантажує
одну polygon story з `#3B82F6`, play/restart у Natural, повторює у Digital.
**qa:inspect:** `uiApi.pass`, `story`, `#story-color-model`, `paint-palette-story.png`.
**qa:expected:** обидва PASS. Чотири story payloads мають точні channels
`[1-130/255,1-59/255,1-246/255]`; play і restart завершуються `completed`.
Після completed зміна story color model відхиляється; select disabled.
Перед відкриттям extension runner обирає `toolPanel.selectExtensionTab('player')`,
потім клікає `#panel-extension-toggle` і `#story-player-tab`; це не запускає
зовнішній Demo catalog fetch, який не входить до B.
Чинний `test:story-ui` додатково перевіряє live/pause/manual takeover/registry/mobile.

### QA-B9. Guard, GPU decode та сумісний другий host

**qa:mode:** cli
**qa:open:** shell у корені; browser source `http://127.0.0.1:52290/examples/minimal/index.html`.
**qa:action:** виконані `npm run test:color`, `npm run lint:shaders`,
`npm run test:tilecraft`, `npm run test:story-ui`, `npm run test:fluid-control`,
`npm run build`, `npm run test:color-adapter`, `npm run test:paint-palette:gpu`,
`npm run test:color-adapter:gpu`, `npm run test:bake`, `npm run test:tilecraft:gpu`,
`npm run test:timing`, `npm run test:live-gpu`, фінальний `npm run build`.
**qa:inspect:** commands.json/stdout/exit codes; `minimal` і `minimal-legacy.png`;
adapter GPU `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-KGmio0/result.json`.
**qa:expected:** усі 14 виконань exit 0; color 42/42, adapter 6/6; adapter GPU
4 режими ×17 decode =68 checks ≤1 byte, 12 deterministic pairs delta 0.
Minimal реально малює з legacy channels: render model 0, material magnitude >0,
app adapter відсутній. Engine/standalone player defaults не мігровано глобально.

### Межі B та журнал

- Власник прийняв B через `handoff:next` 2026-10-13; B закрита.
  Closing rerun: guard B, Paint probe, Bake і tilecraft GPU PASS; color 42/42,
  adapter 6/6. Нові Paint JSON/PNG: `C:/Users/cergi/AppData/Local/Temp/fluid-2-B-MuagKi/`;
  3 пари ×30 steps, frozen/active raw/export delta 0. Фізичний coverage debt збережено.
  C не почато, deploy не виконувався; vendored/зовнішні файли й physics не змінено.
- Snapshot source audit знайшов лише in-memory history/story baseline textures,
  story JSON та PNG import/export; persistent material restore не знайдено.
  Це обмежений audit цього repo, не гарантія для невідомих зовнішніх hosts.
- Реальний Paint probe — desktop SwiftShader; A decode matrix додатково
  WebGL1/2 × float/half-float. Physical GPU/mobile visual review не виконано.
- Тимчасові невдалі спроби виправили метод тесту: initial stroke geometry
  двох повторних runs відрізнялась; тепер одна snapshot fixture, допуск 0.
  Minimal URL виправлено на явний index.html для файлового test server.
- 2026-10-13, B: guard/probe/full npm-equivalent PASS. Порти 52290/49155
  звільнено й перевірено; чужі процеси не зупиняли. Історичні докази A нижче
  не підмінено свіжими результатами B.

## Фаза A — прийнята й закрита 2026-10-13

### QA-A1. Обидві палітри, White/Black і прямий HEX декодуються RGB-рендерером

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=2&gpu=desktop`
**qa:action:** натиснути «Запустити перевірку».
**qa:inspect:** статус біля кнопки та `decode` у звіті під полотном.
**qa:expected:** стійкий `PASS`; 17 зразків, усі `maxDelta <= 1` у byte RGB;
`webgl: 2`, `precision: "float"`. Кольорові зразки й полотно видимі.
Покрито GPU-run, `2-desktop.json` / `2-desktop.png`.

### QA-A2. Перемикання без simulation steps не змінює матеріал

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=2&gpu=desktop`
**qa:action:** натиснути «Запустити перевірку», вибрати Digital у «Палітра».
**qa:inspect:** полотно та `comparisons` у звіті.
**qa:expected:** полотно не змінюється; у всіх трьох порівняннях
`frozenRawDelta: 0`, `frozenExportDelta: 0`; статус залишається `PASS`.
Автомат додатково звірив export bytes до/після реальної зміни select.

### QA-A3. Перемикання при активній симуляції

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=2&gpu=desktop`
**qa:action:** натиснути «Запустити перевірку».
**qa:inspect:** `comparisons` у стійкому звіті.
**qa:expected:** три пари: Natural, Digital, змішані мазки; кожна по 30 однакових
simulation steps, `rawDelta: 0`, `exportDelta: 0`, `activeMaterialDelta > 0`.
Матеріал справді рухався, але перемикання не змінило результат.
Це ізольований engine fixture із відомим потоком `[2,1]`, не production UI.

### QA-A4. WebGL2 half-float fallback

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=2&gpu=iphone-14`
**qa:action:** натиснути «Запустити перевірку».
**qa:inspect:** статус, `precision`, `decode`, `comparisons`.
**qa:expected:** `PASS`, `webgl: 2`, `precision: "half-float"`; 17 декодувань
у допуску 1 byte і всі три порівняння точно рівні. `iphone-14` — capability
clamp на SwiftShader, не результат фізичного iPhone.
Покрито `2-iphone-14.json` / `2-iphone-14.png`.

### QA-A5. WebGL1 float

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=1&gpu=desktop`
**qa:action:** натиснути «Запустити перевірку».
**qa:inspect:** статус і звіт.
**qa:expected:** `PASS`, `webgl: 1`, `precision: "float"`, ті самі числові gates.
Покрито `1-desktop.json` / `1-desktop.png`.

### QA-A6. WebGL1 half-float

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/debug/paint-color-adapter-probe.html?webgl=1&gpu=iphone-14`
**qa:action:** натиснути «Запустити перевірку».
**qa:inspect:** статус і звіт.
**qa:expected:** `PASS`, `webgl: 1`, `precision: "half-float"`, ті самі числові gates.
Покрито `1-iphone-14.json` / `1-iphone-14.png`.

### QA-A7. Чинний production build запускається без міграції матеріалу

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:62865/dist/index.html?debug=none&seed=7`
**qa:action:** нічого.
**qa:inspect:** полотно та панель застосунку.
**qa:expected:** завантажений Paint, без page/console/GL errors; адаптер доступний,
але `colorModel` лишається RYB (`0`). Це smoke, не приймання поведінки фази B.
Покрито GPU-run `production.png`; source `index.html` також перевірено.

### QA-A8. Unit guard адаптера

**qa:mode:** cli
**qa:open:** shell у корені репозиторію.
**qa:action:** `npm run test:color-adapter`.
**qa:inspect:** stdout і код виходу.
**qa:expected:** 6 tests PASS, 0 fail, exit 0; grid охоплює 2400 точок
(дві палітри й обидві black-corner політики), точний HEX, alpha та invalid inputs.

## Метод і допуски A

- Декодування: fixture заливає відомі encoded RGB у справжню paint texture;
  штатний `painting.frag` / `engine.exportPixels` рендерить плоский матеріал.
  Очікувані bytes обчислюються незалежно за штатними diffuse/specular параметрами.
  Не порівнювати освітлений піксель із неосвітленим HEX.
- Найгірше округлення half-float каналу в [0,1] — до `2^-12`; після ×255
  та byte quantization межа приблизно `0.563` byte, ще до малих float похибок
  lighting. Допуск 1 byte обґрунтований для плоского decode; float отримує той
  самий byte gate. Це не універсальний допуск накопичення багатьох мазків.
- Незмінність: допуск **0**, окремо raw material float values та export bytes,
  тільки всередині тієї самої precision/backend і за однакових simulation steps.
  Не вимагаємо тотожності float ↔ half-float або WebGL1 ↔ WebGL2.
- Для активного порівняння використано справжні engine strokes, потім fixture
  задає velocity `[2,1]` і fluidity `0.9`; обидва runs отримують однаковий потік.
  Без нього короткий початковий fixture мав нуль post-stroke руху, тому не
  доводив активну advection. Фізику й production defaults не змінювали.
- Negative control: той самий encoded матеріал через старий RYB renderer дає
  різницю понад 1 byte; fixture здатен помітити помилковий вибір renderer.
- У тестах адаптера production-no-call assertion — тимчасова межа A; у B
  замінити її на новий наскрізний контракт, не зберігати заборону інтеграції.

## Журнал і незакрите

- 2026-10-13, A: color guard 42/42, adapter unit 6/6, shader lint і build PASS.
  Чотири GPU режими × 17 decode = 68 checks; 12 deterministic pairs,
  frozen/active raw/export delta 0. Source і production smoke PASS.
- `make` відсутній. Npm-еквівалент усього старого `make verify` виконано:
  shader lint, color, timing, tilecraft, live GPU, tilecraft GPU, story UI,
  Bake і production build — PASS. Нові adapter guard/probe теж PASS і додані
  до Makefile fast/browser tiers. Без повторного прогону незмінених suites.
- 2026-10-13: власник прийняв A через `handoff:next`; питання HEX/White/Black
  закриті в спеці й HANDOFF. Фізичні GPU/мобільні пристрої — **не перевірено**.
  Integration у реальному Paint, story/API, Undo/Redo та перемикання palette
  належать B. Shader bundling належить C. Код A і closure-документи входять
  у closing commit; deploy не виконували. Фізичне coverage debt збережене.

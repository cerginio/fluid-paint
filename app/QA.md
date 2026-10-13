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

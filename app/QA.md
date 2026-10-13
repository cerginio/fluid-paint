# QA: fluid-2

Сценарії накопичувальні; нові фази додаються згори. Production Paint у фазі A
ще використовує старий матеріал. Deploy не виконується.

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

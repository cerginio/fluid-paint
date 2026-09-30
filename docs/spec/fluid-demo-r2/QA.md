# QA: Fluid Paint — публічні демо з R2

Для локальної проби з кореня Fluid Paint після `make install` запустити
`make demo-qa-server`. Відкрити URL нижче у браузері.
Проби фаз 1–2 використовують контрольовані JSON-відповіді; інтернет і R2
для них не потрібні.
Після перевірки зупинити сервер через Ctrl+C.

## Фаза 4 — мапінг Tilecraft і Fluid Play

**Рев'ю:** власник прийняв фазу командою `handoff:next` 2026-09-30.
QA-4U1 та QA-4F1–QA-4F4 перевірені автоматичними браузерними пробами;
візуальне порівняння на парі стендів і залишкові обмеження наведені нижче.

Локально: Tilecraft запустити на `127.0.0.1:8080` із коренем
`D:/work/js-games/ua-dream/tilecraft`; Fluid Paint — `make demo-qa-server`
на `127.0.0.1:3000`. Інтернет не потрібен. Автоматичні браузерні проби
`node debug/tilecraft-source-model-ui-test.js` і
`node debug/tilecraft-spot-gpu-test.js` самі закривають запущені ними сервери.
Якщо на 8080 уже працює Tilecraft, перша проба використовує його без зупинки.

### Tilecraft: джерельна модель

#### QA-4U1. Експорт не масштабує кількість вершин

**Відкрити:** `http://127.0.0.1:8080/tests/fluid-player-model-probe.html`.
**Клікнути:** `Run triangle export`.
**Дивитись:** рядок під кнопкою.
**Очікуваний результат:** `polygonSize=3 a=128 sa=0.523599 fit.scale=3.3`.
Покрито браузерною пробою `debug/tilecraft-source-model-ui-test.js`.

### Fluid Paint: імпорт і зв'язка

Для QA-4F1–QA-4F3 вибрати файл
`docs/spec/fluid-player-ux-fix/triangle-parity.json` на диску. Він містить
4 окремі кольорові трикутники та один трикутник із `mod=2`, що дає два
контакти; друга пляма має `a=128` і `sa=π/6`.

#### QA-4F1. Форма й прозорість у Digital

**Відкрити:** `http://127.0.0.1:3000/index.html?seed=20260930&debug=none`.
**Клікнути:** `+`, у File вибрати `triangle-parity.json`, у Player вибрати
`Import colors → Digital / RGB`, натиснути `Play`.
**Дивитись:** полотно, статус Player і поле Import colors.
**Очікуваний результат:** статус `Playback completed.`; на полотні видно
трикутні, а не круглі плями, друга зелена пляма блідіша за непрозорі;
подвійний трикутник унизу має дві орієнтації; вибір лишається
`Digital / RGB`. Автоматична браузерна проба перевіряє 6 трикутних
операцій, альфу другої, два кути `mod=2` та RGB-пігмент червоного `[1,0,1]`.

#### QA-4F2. Повторний запуск у Natural

**Відкрити:** `http://127.0.0.1:3000/index.html?seed=20260930&debug=none`.
**Клікнути:** `+`, у File вибрати `triangle-parity.json`, у Player вибрати
`Digital / RGB`, натиснути `Play`; після завершення — `Keep result`,
обрати `Natural / RYB`, натиснути `Play`.
**Дивитись:** поле Import colors, статус і полотно.
**Очікуваний результат:** другий запуск завершується статусом
`Playback completed.`, поле показує `Natural / RYB`; червоний кодується
RYB-пігментом `[1,0,0]`, а форми лишаються трикутними. Це перевіряє
`debug/tilecraft-spot-gpu-test.js`.

#### QA-4F3. Кількість фарби одного контакту

**Відкрити:** `http://127.0.0.1:3000/index.html?seed=20260930&debug=none`.
**Клікнути:** нічого; запустити з кореня Fluid Paint
`node debug/tilecraft-spot-gpu-test.js`.
**Дивитись:** JSON-рядок `manual`, `replay`, `massRatio`, `areaRatio` у терміналі.
**Очікуваний результат:** обидва контакти мають трикутний показник `h3 > 0.1`,
`massRatio` і `areaRatio` у межах `0.85…1.15`; контрольний прогін 2026-09-30
дав 1802.20 alpha mass, 23 164 покритих пікселі та `h3=0.254` для
обох контактів при `seed=20260930`, DPR 1 і одному короткому tap.

#### QA-4F4. Кількість фарби одного path-переходу

**Відкрити:** `http://127.0.0.1:3000/index.html?seed=20260930&debug=none`.
**Клікнути:** нічого; запустити `node debug/tilecraft-spot-gpu-test.js`.
**Дивитись:** JSON-рядок `manualPath`, `replayPath`, `pathMassRatio`,
`pathAreaRatio` у терміналі.
**Очікуваний результат:** `pathMassRatio` і `pathAreaRatio` у межах
`0.85…1.15`; контрольний прогін дав 2904.47 проти 2893.86 alpha mass
(`0.9963×`) і 12 881 проти 12 871 покритих пікселів (`0.9992×`) для
одного прямого переходу за один tick.

### Обмеження до review

- Числовий GPU допуск вище стосується одного короткого tap та одного
  прямого path-переходу з однаковим розміром і налаштуваннями пензля.
  Утримання на 3/10 tick та змішані плями на реальній парі стендів не виміряні.
- `mod=2` використовує два контакти. У зоні їх перетину фарба може бути
  густішою за один Canvas fill у Tilecraft; це треба оцінити візуально.
- Natural/RYB наближає кольори поза гамою. Зміна режиму для наявної мокрої
  фарби впливає на весь шар, тому для порівняння двох режимів використовувати
  `Replace current painting` і повторний запуск.

## Фаза 3 — публічний R2 і live інтеграція

**Рев'ю:** власник прийняв фазу командою `handoff:next` 2026-09-30.
Перевірка реального DNS у його мережі та викладка CSS лишаються
операційними пунктами нижче.

Для цих сценаріїв потрібен інтернет. Локально запустити `make demo-qa-server`
на порту 3000; production адреса — `https://fluid-paint.netlify.app/`.
Сценарії QA-3A–QA-3E перевіряють зовнішній каталог і зв'язку з ним.

**Виміряно 2026-09-30:** канонічний `story-catalog-index.mjs --check` пройшов:
три моделі по 8 кадрів і 2 шари. GET index та кожної моделі з Origin
`https://fluid-paint.netlify.app`, `http://localhost:3000` і
`http://127.0.0.1:3000` повернув 200, `application/json` і точний
`Access-Control-Allow-Origin`; SHA-256 кожної відповіді збігся з відповідним
канонічним fixture (763, 4 095 097, 4 094 566 і 4 093 329 байти).
У мережі цієї проби TLS CDN прийнятий Node і Chromium; у мережі власника
`cdn.storytilecraft.cc` блокується з помилкою сертифіката. Резервний
`r2.dev/fluid-demo/` віддав ті самі чотири файли для всіх трьох Origin:
12 відповідей 200 з точним CORS і SHA-256, що збігається з fixture.

**Локальна браузерна проба:** на `http://127.0.0.1:3000/` з реальним CDN
показано три назви; кожен slug завантажив свою модель, відкрив Player,
показав `Painting story…`, 8 кадрів і 46 861 drawable items. Помилок сторінки
не було. Progress для polygon зріс з 1% до 4% за 30 секунд у Chromium із
SwiftShader на швидкості 16×. Повного завершення відтворення ця проба не
підтвердила: очікування 180 секунд вичерпалось. QA-3C–QA-3E лишаються
для візуальної перевірки власником.
Після успішного live index локальна проба вимкнула мережу: Refresh зберіг
три option, вибраний polyline і доступну Run; після повернення мережі
статус знову показав `3 demos · Last update:`.
Коли Chromium примусово відхилив CDN-запити, реальний `r2.dev` віддав index
і `story-8-frames-hibrid.json`; Player перейшов у `playing`, показав 8 кадрів
і 46 861 drawable items без помилок сторінки. Це перевіряє код обходу,
але не відтворює DNS мережі власника.
Guard після узгодження коефіцієнта пензля: `npm run test:story-demo` — 8/8;
`npm run test:story-ui`, `npm run test:ui-preset`, `npm run test:tilecraft`
і `npm run build` — PASS. `npm run test:story-demo:ui` — PASS.
Після виправлення UI локальний Chromium на ширині 1016 і 320 px показав усі
чотири вкладки без обрізання тексту; панель була в межах viewport, а option
Demo мав темний текст `rgb(17, 17, 17)` на білому фоні. Повторний
`npm run test:story-demo:ui` і `npm run build` — PASS.

**Стан production:** `https://fluid-paint.netlify.app/?debug=none` показує
Demo й три назви. При примусовій відмові CDN Chromium завантажив index і
кожну з трьох моделей через `r2.dev` (усі GET 200, 8 кадрів і 46 861
drawable items, Player перейшов у `playing`). Це перевірка production
коду, але не DNS у мережі власника. CSS-виправлення списку й вкладок ще
не розгорнуто: production option лишається білим текстом на прозорому
фоні. У цьому QA немає рядка `**Деплой:**`; команда автоматичного деплою
для теми не задана.

### QA-3A. Резервний публічний index

**Відкрити:** `https://pub-17dfba1e4d9148e7bcd3547a717794f9.r2.dev/fluid-demo/index.json`.
**Клікнути:** нічого.
**Дивитись:** JSON-відповідь та адресу в браузері.
**Очікуваний результат:** `schemaVersion: 1`, три записи зі slug
`story-8-frames-polygon`, `story-8-frames-polyline`,
`story-8-frames-hibrid`; попередження TLS немає.

### QA-3B. Локальний браузер читає R2 з CORS

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none`.
**Клікнути:** `+` у панелі Fluid Paint.
**Дивитись:** вкладки й список Demo; Network у DevTools для
`/fluid-demo/index.json`.
**Очікуваний результат:** вкладки `Demo | File | Player | State`, три назви
історій, статус `3 demos · Last update:` з часом; GET з CDN або резервного
`r2.dev` має 200 і `Access-Control-Allow-Origin: http://127.0.0.1:3000`.

### QA-3C. Polygon з R2

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none`.
**Клікнути:** `+`, вибрати `Story Rombs (polygon)`, натиснути `Run`.
**Дивитись:** вкладка Player, summary, статус, progress і canvas.
**Очікуваний результат:** Player активний; видно `story-8-frames-polygon`,
`8 frames`, `46,861 drawable items`; статус `Painting story…`, progress
зростає, на canvas з'являється фарба.

### QA-3D. Polyline з R2

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none`.
**Клікнути:** `+`, вибрати `Story Rombs (polyline)`, натиснути `Run`.
**Дивитись:** вкладка Player, summary, статус, progress і canvas.
**Очікуваний результат:** Player активний; видно `story-8-frames-polyline`,
`8 frames`, `46,861 drawable items`; статус `Painting story…`, progress
зростає, на canvas з'являється фарба.

### QA-3E. Hibrid з R2

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none`.
**Клікнути:** `+`, вибрати `Story Rombs (hybrid)`, натиснути `Run`.
**Дивитись:** вкладка Player, summary, статус, progress і canvas.
**Очікуваний результат:** Player активний; видно `story-8-frames-hibrid`,
`8 frames`, `46,861 drawable items`; статус `Painting story…`, progress
зростає, на canvas з'являється фарба.

### QA-3F. Production читає три демо

**Відкрити:** `https://fluid-paint.netlify.app/?debug=none`.
**Клікнути:** `+` у панелі Fluid Paint.
**Дивитись:** вкладки й список Demo; Network у DevTools для
`/fluid-demo/index.json`.
**Очікуваний результат:** `Demo | File | Player | State`, три назви,
`3 demos · Last update:`; GET з CDN або резервного `r2.dev` має 200 і
`Access-Control-Allow-Origin: https://fluid-paint.netlify.app`.

### QA-3G. Помилка Refresh зберігає список

**Відкрити:** `https://fluid-paint.netlify.app/?debug=none`.
**Клікнути:** `+`, дочекатись трьох назв, у DevTools Network ввімкнути
`Offline`, натиснути `Refresh index`, повернути `Online`.
**Дивитись:** список, вибір і статус Demo.
**Очікуваний результат:** три назви й вибір залишаються; статус починається
`Could not update demos:`. Повторний `Refresh index` після повернення мережі
показує `3 demos · Last update:`.

### QA-3H. Заблокований CDN не ховає список

**Відкрити:** `https://fluid-paint.netlify.app/?debug=none` у мережі, де
`cdn.storytilecraft.cc` дає помилку сертифіката.
**Клікнути:** `+` у панелі Fluid Paint.
**Дивитись:** список Demo й Network у DevTools для `/fluid-demo/index.json`.
**Очікуваний результат:** три назви й `3 demos · Last update:`; невдалий
CDN-запит супроводжується GET `r2.dev/fluid-demo/index.json` зі статусом 200.
Перша помилка CDN може залишитися в консолі браузера.

### QA-3I. Заблокований CDN не зупиняє Run

**Відкрити:** `https://fluid-paint.netlify.app/?debug=none` у тій самій мережі.
**Клікнути:** `+`, вибрати `Story Rombs (hybrid)`, натиснути `Run`.
**Дивитись:** вкладка Player, summary, progress і Network у DevTools.
**Очікуваний результат:** видно `story-8-frames-hibrid`, `8 frames`,
`46,861 drawable items`; статус `Painting story…`, progress зростає;
GET `r2.dev/fluid-demo/story-8-frames-hibrid.json` має статус 200.

### QA-3J. Пункти списку Demo читаються

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none`.
**Клікнути:** `+`, потім список `Choose a story`.
**Дивитись:** відкритий список назв Demo.
**Очікуваний результат:** усі три назви видно темним текстом на світлому
фоні; вибраний пункт читається й у закритому полі.

### QA-3K. Вкладки вміщуються на вузькому екрані

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none` у viewport
320 × 758 px.
**Клікнути:** `+`.
**Дивитись:** заголовок панелі Story tools і краї viewport.
**Очікуваний результат:** `Demo | File | Player | State` видно повністю,
кнопка `×` доступна; панель не виходить за 8 px від країв viewport.

## Фаза 2 — Demo UI і Player

**Рев'ю:** QA-2A–QA-2K пройдені власником 2026-09-30.

Проба повного UI: `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
На сторінці зверху є перемикачі контрольованих помилок. Сам застосунок —
у рамці під ними. Натискання `Reset app` відновлює початковий стан рамки.
Сценарії нижче покриті `npm run test:story-demo:ui`; вузький layout також
перевірено при 390 × 844. Для ручної перевірки потрібен браузер із WebGL.

### QA-2A. Перший вхід і список

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** `+` у панелі застосунку.
**Дивитись:** вкладки та список Demo у панелі, лічильник угорі сторінки проби.
**Очікуваний результат:** `Demo | File | Player | State`; три назви `Story Rombs (polygon)`, `Story Rombs (polyline)`, `Story Rombs (hibrid)`; статус містить `3 demos · Last update:`; лічильник `1 index · 0 model requests`.

### QA-2B. Вибір не завантажує модель

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** `+`, потім у списку Demo вибрати `Story Rombs (polyline)`.
**Дивитись:** метадані під списком і лічильник угорі сторінки проби.
**Очікуваний результат:** метадані містять `story-8-frames-polyline · 8 frames · 3.9 MB · Tilecraft fixtures`; лічильник лишається `1 index · 0 model requests`.

### QA-2C. Невдалий Refresh зберігає список

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** `+`, вибрати `Story Rombs (polyline)`, увімкнути `Fail index` над застосунком, натиснути `Refresh index` у Demo.
**Дивитись:** список і статус Demo, лічильник угорі.
**Очікуваний результат:** список має ті самі три назви, обрано `Story Rombs (polyline)`; статус починається `Could not update demos:`; лічильник `2 index · 0 model requests`.

### QA-2D. Невдалий Run зберігає Demo і canvas

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** увімкнути `Fail model` над застосунком, натиснути `+`, потім `Run` у Demo.
**Дивитись:** активна вкладка, повідомлення Demo, canvas, лічильник угорі.
**Очікуваний результат:** активною лишається Demo, статус починається `Could not run demo:`; canvas не змінюється, `Run` знову доступна; лічильник `1 index · 1 model requests`.

### QA-2E. Run запускає Player

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** `+`, потім `Run` у Demo.
**Дивитись:** активна вкладка Player, статус і progress, canvas, лічильник угорі.
**Очікуваний результат:** Player стає активним, під назвою видно `story-8-frames-polygon`; статус проходить `Painting story…` → `Playback completed.`; progress зростає; canvas має червоні точки; лічильник `1 index · 1 model requests`.

### QA-2F. Pause, Resume, Stop і Restore

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** `+`, `Run`, після завершення `Keep result`, у Player Speed вибрати `0.25×`, вкладку `Demo`, `Run`, далі `Pause`, `Resume`, `Stop`, `Restore canvas`.
**Дивитись:** статус Player, progress і canvas.
**Очікуваний результат:** після Pause статус `Playback paused.` і progress зупиняється; після Resume він зростає; після Stop з'являється `Playback stopped. Restore the canvas or keep the partial result.`; після Restore canvas повертається до стану перед Run, статус `Ready.`.

### QA-2G. Без Demo немає R2-запиту

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none&uiMode=preset&uiPreset=draw-min`.
**Клікнути:** нічого.
**Дивитись:** кнопка відкриття додаткових інструментів і вкладки; Network у DevTools з фільтром `fluid-demo`.
**Очікуваний результат:** кнопки `+` і вкладки Demo немає; `fluid-demo` запитів немає.

### QA-2H. Player без demo-r2

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none&uiMode=features&uiFeatures=player`.
**Клікнути:** `+`.
**Дивитись:** вкладки додаткової панелі та Network у DevTools з фільтром `fluid-demo`.
**Очікуваний результат:** є тільки вкладка `Player`; вкладки Demo немає, `fluid-demo` запитів немає.

### QA-2I. Залежність від Player

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none&uiMode=features&uiFeatures=demo-r2`.
**Клікнути:** нічого.
**Дивитись:** повідомлення на сторінці.
**Очікуваний результат:** `Fluid UI configuration error (UI_FEATURE_DEPENDENCY).` і посилання `Open the default interface`.

### QA-2J. Empty не завантажує Demo

**Відкрити:** `http://127.0.0.1:3000/index.html?debug=none&uiMode=empty`.
**Клікнути:** нічого.
**Дивитись:** canvas і Network у DevTools з фільтром `fluid-demo`.
**Очікуваний результат:** canvas видимий, панелі й вкладки Demo немає; `fluid-demo` запитів немає.

### QA-2K. Перший index недоступний

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-ui-probe.html`.
**Клікнути:** увімкнути `Fail index`, потім `+`; вимкнути `Fail index` і натиснути `Retry` у Demo.
**Дивитись:** список, кнопку Run і статус Demo.
**Очікуваний результат:** до Retry список порожній, Run неактивна, статус починається `Could not update demos:`; після Retry є три назви та статус `3 demos · Last update:`.

## Фаза 1 — catalog client і preflight

**Рев'ю:** QA-1A і QA-1B пройдені власником 2026-09-30.

### QA-1A. Валідний каталог і модель

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-catalog-probe.html`.
**Клікнути:** `Run valid catalog`.
**Дивитись:** рядок під кнопками.
**Очікуваний результат:** `1 demo; 8 frames; 1 drawable; 2 requests`.
Перевірено автоматизованою браузерною пробою 2026-09-30; людина може
перевірити видимий результат.

### QA-1B. Обмеження потоку до JSON.parse

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-catalog-probe.html`.
**Клікнути:** `Run oversized response`.
**Дивитись:** рядок під кнопками.
**Очікуваний результат:** `Rejected oversized index: Demo response exceeds the 131072 byte limit.`
Перевірено автоматизованою браузерною пробою 2026-09-30.

## Ще не закрито

- QA-3H–QA-3I у мережі власника без примусового блокування CDN.
- Production деплой CSS та QA-3J–QA-3K на production.
- Візуальне приймання власником QA-3C–QA-3E, включно з поведінкою canvas
  протягом повного відтворення.

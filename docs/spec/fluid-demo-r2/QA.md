# QA: Fluid Paint — публічні демо з R2

Для локальної проби з кореня Fluid Paint після `make install` запустити
`make demo-qa-server`. Відкрити URL нижче у браузері.
Проба використовує контрольовані JSON-відповіді; інтернет і R2 не потрібні.
Після перевірки зупинити сервер через Ctrl+C.

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

## Ще не реалізовано

- Публічні файли, CORS та live перевірка CDN — фаза 3.

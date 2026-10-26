# QA: fluid-session — швидкість Max і запис сесії

Локальний запуск: у `D:\work\fluid-paint\fluid-paint` виконати `npm run dev`. Команда
збирає `dist/` і піднімає сервер на `http://127.0.0.1:3000/`. Інтернет не потрібен.
Fixture для сценаріїв лежить на диску: `D:\work\fluid-paint\fluid-paint\docs\story-2026-09-08-4-frames.json`
(25 871 операція). Сервер `dist/` його не роздає, тому `?story=1&storySpeed=max` на dev-сервері
не працює. Цей шлях покриває `npm run test:tilecraft:gpu` (сторінка з кореня репо).

Довідкові числа з desktop-QA (AMD Radeon 890M, D3D11, 2026-10-26), повний fixture:
1× за планом — 43,0 с; 16× — 13,5 с (1 918 оп/с); Max — 3,8 с (6 838 оп/с).

## Фаза 2 — гачки рушія і spike детермінізму (SPEC §2.3) — прийнято 2026-10-26

Журнал: фаза без UI, тому всі сценарії CLI. Сервер не потрібен: кожна проба піднімає власний
на випадковому порту й закриває його. Інтернет не потрібен. Агент виконав кроки в eval фази
(SwiftShader і AMD 890M); власник пройшов QA-R1–R5 сам, усі з кодом 0, і прийняв фазу через
`handoff:next`. Його числа: float `identicalBytes: 1`; float32 `maxDelta` 0 (SwiftShader) і 1
(890M); `spec` 0,914, `fine` ≈ 0,931; контроль 0,82 / 0,76 / 255. Проба записує мазки на одній сторінці й повторює на свіжих, усі без
`?seed=`; один прогін триває ≈ 60 с. Хеші між прогонами різні, бо `Math.random` дає іншу
варіацію натискання. Порівнюється частка пікселів, хеш — ні.

### QA-R1. Повтор після перезавантаження побітово точний

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:session-replay:gpu`
**qa:inspect:** рядки stdout `"variant":"float"` і `"variant":"float32 ticks"`; код виходу.
**qa:expected:** для `float` — `"identicalBytes":1`, `"maxDelta":0`. Для `float32 ticks` —
`"withinTwo":1` і `"maxDelta"` 0 або 1 (1 буває через CPU-межу splat-області у float64). Код виходу 0.

### QA-R2. Те саме на справжньому GPU

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`; машина з дискретним або
інтегрованим GPU під Windows.
**qa:action:** `node debug/session-replay-gpu-test.js --hardware`
**qa:inspect:** поле `renderer` у рядку `"check":"recording"`; рядки `float` і `float32 ticks`.
**qa:expected:** `renderer` називає справжній GPU (на desktop-QA —
`ANGLE (AMD, AMD Radeon(TM) 890M Graphics … Direct3D11 …)`), а не `SwiftShader`. Числа ті самі,
що в QA-R1. Код виходу 0.

### QA-R3. Кванти SPEC не тримають AC-REC-5

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:session-replay:gpu`
**qa:inspect:** рядок `"check":"AC-REC-5 by quantum"`.
**qa:expected:** `"spec"` ≈ 0,91 (91–92 % пікселів у межах ±2; AC-REC-5 вимагає ≥ 0,99),
`"fine"` ≈ 0,93 (квант 1/65536 px — краще не стає), `"contactXY":1`. Це вимір, а не
assert: тест від нього не падає. На цьому факті стоїть рішення про формат тіків.

### QA-R4. Проба бачить різницю

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:session-replay:gpu`
**qa:inspect:** рядок `"variant":"control: float, no reseed"`.
**qa:expected:** `"identicalBytes"` < 1 (≈ 0,82), `"withinTwo"` ≈ 0,76, `"maxDelta":255`.
Без записаного bristle seed повтор інший — отже 100 % у QA-R1 не порожній збіг.

### QA-R5. API обсервера і повтору на юніт-рівні

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:timing`
**qa:inspect:** останній рядок stdout.
**qa:expected:** `live timing: PASS (hold, 30/60/144 Hz, bounded burst, cursor, endpoint, tap,
overload, repeated resume, stepTick, session observer, replay)`, код виходу 0.

### Відомо зламане / не реалізоване у фазі 2

- `npm run test:bristle-shape` падає з `round footprint has a strong 3-fold harmonic (0.0895)` —
  так само на `HEAD` до фази 1, не від цієї фази.
- Запису, кодека й UI ще немає (фази 3–4): `.flus` зберегти чи відкрити поки нічим.
- Формат тіків не вирішено: див. QA-R3 і рішення власника в HANDOFF.

## Фаза 1 — швидкість Max (SPEC §1) — прийнято 2026-10-26

Журнал: фаза 1 прийнята власником через `handoff:next`. Кроки всіх сценаріїв виконані агентом
на dev-сервері до review (Chromium headed, AMD 890M).

### QA-M1. Опція Max остання в списку швидкостей

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/?debug=none&diag=0`
**qa:action:** кнопка `+` (Show additional tools) → вкладка **File** → «choose a local file» →
вибрати fixture `docs/story-2026-09-08-4-frames.json`. Вкладка **Player** відкривається сама.
Розкрити select **Speed**.
**qa:inspect:** список опцій select **Speed**.
**qa:expected:** 8 опцій: `0.25×`, `0.5×`, `1×`, `2×`, `4×`, `8×`, `16×`, `Max`. `Max` остання,
одразу під `16×`; типово вибрано `8×`. Покрито `test:story-ui`.

### QA-M2. Статус Max спершу міряє, потім показує виміряне

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/?debug=none&diag=0`, fixture відкритий, як у QA-M1.
**qa:action:** Speed → `Max` → **Play**.
**qa:inspect:** рядок статусу під кнопками Player.
**qa:expected:** приблизно першу секунду видно `Playing · Max (measuring…)`. Потім
`Playing · Max ≈ N× · T ticks/s · S s left`, де N і T ростуть (на desktop-QA за 2 с
від `≈ 4×` до `≈ 10×`, T від ≈ 2 400 до ≈ 5 900), а S зменшується. Рядок оновлюється
не частіше 2 разів на секунду. Після кінця — `Playback completed.` Формат покрито `test:story-ui`.

### QA-M3. Pause на Max реагує одразу

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/?debug=none&diag=0`, fixture відкритий, Speed `Max`, Play.
**qa:action:** приблизно через 2 с після Play натиснути **Pause**, потім **Resume**.
**qa:inspect:** полотно та рядок статусу.
**qa:expected:** після Pause малювання зупиняється без помітної затримки (на desktop-QA стан
`paused` за 39 мс), статус `Playback paused.` Після Resume малювання продовжується з того самого
місця, без повторного нанесення вже намальованого, і доходить до `Playback completed.`

### QA-M4. Max не повільніший за 16×

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/?debug=none&diag=0`, fixture відкритий.
**qa:action:** Speed `16×` → Play, засікти час до `Playback completed.` Потім **Replay**
на Speed `Max`, засікти так само.
**qa:inspect:** секундомір і полотно під час програвання.
**qa:expected:** Max закінчує щонайменше так само швидко, як 16× (на desktop-QA 3,8 с проти
13,5 с). Під час Max полотно не завмирає довше ніж на секунду, а кнопки й курсор відгукуються.

### QA-M5. Перемикання на Max під час програвання

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/?debug=none&diag=0`, fixture відкритий.
**qa:action:** Speed `2×` → Play. Приблизно через 3 с, не зупиняючи, вибрати Speed `Max`.
**qa:inspect:** полотно в місці, де щойно малювало, і рядок статусу.
**qa:expected:** програвання продовжується з поточного місця, швидше. Статус переходить у
`Playing · Max (measuring…)`, потім `≈ N×`. Вже намальовані мазки не повторюються і не темнішають.

### QA-M6. Картинка Max така сама, як 16× (очима)

**qa:mode:** browser
**qa:open:** дві вкладки `http://127.0.0.1:3000/?debug=none&diag=0&seed=7`, у кожній відкритий fixture.
**qa:action:** у першій вкладці Speed `16×` → Play, у другій Speed `Max` → Play. Дочекатися
`Playback completed.` в обох.
**qa:inspect:** полотна двох вкладок поруч.
**qa:expected:** малюнки однакові: ті самі мазки, кольори, розтікання. Побітову рівність на
зрізі fixture (186 операцій) перевіряє `test:tilecraft:gpu` (AC-MAX-2). На desktop-QA повний
fixture з `seed=7` дав однаковий hash `exportPixels()` для 16× і Max (`4133746985`).

### Свідомо не виправлено у фазі 1

- **4×, 8× і 16× на великому fixture грають однаково.** Timeline-режим пропускає не більше
  32 операцій за кадр, тобто 1 920 оп/с при 60 Гц. Для цього fixture 1× — це 601 оп/с, тож
  стеля спрацьовує вже з 4×: виміряне 16× ≈ 3,2× (1 918 оп/с). Вада була до фази. Max її
  обходить, бо стелю задає `BudgetTickScheduler`.
- **Max розганяється приблизно 2 с.** K стартує з 16 тіків за кадр і росте на 1 за кадр (AIMD
  за SPEC §1.3). Тому статус спершу показує `≈ 4×` і лише потім виходить на плато.
- `?storySpeed=max` працює тільки разом із `?story=1`, а на dev-сервері fixture не роздається.

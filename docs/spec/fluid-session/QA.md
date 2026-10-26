# QA: fluid-session — швидкість Max і запис сесії

Локальний запуск: у `D:\work\fluid-paint\fluid-paint` виконати `npm run dev`. Команда
збирає `dist/` і піднімає сервер на `http://127.0.0.1:3000/`. Інтернет не потрібен.
Fixture для сценаріїв лежить на диску: `D:\work\fluid-paint\fluid-paint\docs\story-2026-09-08-4-frames.json`
(25 871 операція). Сервер `dist/` його не роздає, тому `?story=1&storySpeed=max` на dev-сервері
не працює. Цей шлях покриває `npm run test:tilecraft:gpu` (сторінка з кореня репо).

Довідкові числа з desktop-QA (AMD Radeon 890M, D3D11, 2026-10-26), повний fixture:
1× за планом — 43,0 с; 16× — 13,5 с (1 918 оп/с); Max — 3,8 с (6 838 оп/с).

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

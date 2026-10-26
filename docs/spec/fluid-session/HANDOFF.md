# Handoff: fluid-session — швидкість Max і запис сесії малювання

Стан на 2026-10-26, гілка `feat/pwa`. Фаза 1 закрита й закомічена: код теми,
`QA.md` і цей файл. Спека
[`docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md`](../../PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md)
(далі — SPEC) закомічена в `a4009a1`.

> **Далі:** фаза 2 — гачки рушія і spike детермінізму (пункт 2 нижче).

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `fluid-engine/index.js` | `_tick(previous, current, t)` — один крок, спільний для `advance()` і `stepTick()`; `_finishTicks()` пише `timingStats`. `stepTick()` — рівно один крок із поточною live-ціллю (t = 1), годинник `_lastAdvance` не чіпає. Фаза 2 додає сюди `replayTick()` через той самий `_tick()`. |
| `fluid-engine/tilecraft-stroke-player.js` | Top-level `FixedTickScheduler`, `BudgetTickScheduler` (+ статики `TilecraftStrokePlayer.*`). `_tickScheduler(options)` валідує `tickScheduler` / `ticksPerFrame`. `playPlan()`: два порядки тіків — legacy `ticksPerFrame` (тік ПІСЛЯ операції) і paced (тік ПЕРЕД наступною операцією: усі timeline-швидкості та Max); межі кадрів дає scheduler, для timeline типово `FixedTickScheduler(32)`. |
| `app/story-playback-controller.js` | `setSpeed('max')`; Max — `targetDuration: null` + `BudgetTickScheduler`; `_advanceStoryTick()` = `engine.stepTick()`; `ownsEngineClock`; вимірювач `_startRateMeter/_sampleRate` → `maxRate {multiplier, ticksPerSecond}` і `estimatedRemaining` у view model. |
| `paint.js` | `update()`: поки story грає і володіє пензлем (`ownsEngineClock`), хост лише `resetClock()`, без власних кроків. |
| `app/ui/story-tools.js` | `StoryToolsUI.parseSpeed()`; статус `Playing · Max (measuring…)` → `Playing · Max ≈ N× · T ticks/s · S s left`. |
| `index.html` | Опція `Max` під `16×`; `?story=1&storySpeed=max`. |
| `debug/story-max-scheduler-test.js` (`npm run test:story-max`) | AIMD на фейковому годиннику: старт 16, бюджет 10 мс, ×0,7 після двох довгих кадрів, стеля 256, підлога 1, скидання після паузи > 1 с. |
| `debug/tilecraft-story-gpu-test.js` | AC-MAX-2/3: зріз fixture (150 тайлів/шар = 186 операцій), `seed=7`, тік +20 мс і ривок +20 мс після `resetClock`; hash 16× == Max, кожен тік = 1 крок, `simulate()`-викликів = тіків. |
| `debug/story-player-ui-test.js`, `debug/live-timing-test.js` | AC-MAX-1/5 (опція, формат статусу); юніт `stepTick()`. |
| `paint.js` `save()` | PNG через anchor `download`; фаза 3 перевикористовує для `.flus`. |

## Інваріанти теми

**INV-MAX-1.** Кожен story-тік — рівно один `simulate()`; поки story грає, хост не додає власних
кроків. *Походження:* SPEC §1.4, фаза 1 (2026-10-26): старий `_advanceStoryTick()` давав
`advance(max(storyClock, wall) + 1/60)`, і тік довший за 16,7 мс вставляв ще один інтерпольований
крок; RAF хоста кроком `advance(wall)` між кадрами story додавав кроки на ривках кадру.
*Механізм:* `engine.stepTick()` + `Paint.update()` пропускає `advance()` при `ownsEngineClock`.
*Перевірка:* `npm run test:tilecraft:gpu` — `multiStepTicks === 0`, `simulateCalls === ticks`,
hash 16× == Max. *Доведено мутаціями:* повернення старого годинника → 186 тіків по 2 кроки
(падає); вимкнення придушення в `paint.js` → 191 `simulate()` на 186 тіків (падає). Без ривка
+20 мс після `resetClock` друга мутація проходила — його не прибирати.

## Головні виміряні факти

Фаза 1 (2026-10-26, desktop-QA: AMD Radeon 890M, ANGLE D3D11, Chromium headed, 1280×800):

- Повний fixture `docs/story-2026-09-08-4-frames.json` = **25 871 операція** плану
  (22 720 тайлів). 1× за планом (`targetPlaySeconds`) — 43,0 с ≈ 601 оп/с.
- **16× — 13,5 с, 1 918 оп/с ≈ 3,2× реально.** Це стеля timeline-режиму: ≤ 32 оп/кадр × 60 Гц
  = 1 920 оп/с. Медіанний кадр 16,7 мс — GPU не вузьке місце. Отже 4×, 8×, 16× на цьому fixture
  обмежені тією самою стелею (з 4× — арифметично; виміряно лише 16×).
- **Max — 3,8 с, 6 838 оп/с ≈ 9,5×**, медіанний кадр 16,7 мс, найдовший відрізок кадрів > 2·D —
  50 мс (AC-MAX-4 ✓). Статус розганяється `≈ 4×` → `≈ 10×` за ~2 с (K +1/кадр).
- Повний fixture, `seed=7`: hash `exportPixels()` 16× == Max (`4133746985`) — AC-MAX-2 на справжньому GPU.
- SwiftShader (зріз 186 оп, штучні +20 мс): 16× 7,6 с, Max 11,4 с — на штучно повільному тіку
  бюджет 10 мс дає 1 тік/кадр; це очікувано і не порушує AC-MAX-4 (він про desktop).
- **Спростовано:** «вузьке місце на 16× — CPU-накладні draw calls щетинок». Вузьке місце —
  стеля 32 оп/кадр у `waitTimeline()`. На Max ≈ 114 тіків/кадр при 60 Гц (≈ 0,09 мс CPU/тік).
- `test:bristle-shape` падає і на чистому `HEAD` (`round footprint has a strong 3-fold harmonic
  (0.0895)`) — до фази, не через неї.

Виміряне раніше (статично, з коду та fixture):

- Fixture: 1 955 380 Б, 86 Б/точку; gzip — 360 649 Б (≈ 16 Б/точку). База для AC-REC-6.
- Один крок: `Brush.update` з `ITERATIONS = 20` (≈ 80–100 draw calls) + 2 splat + 7 проходів
  рідини; рідина обробляє union-прямокутник splat-областей `FRAMES_TO_SIMULATE = 60` кроків
  (після цього `simulate()` — no-op; GPU-тести «осаджують» 80 × `stepTick()`).
- `randomsTexture` заповнюється один раз у конструкторі `Brush` з `engine.random`
  (`Math.random`, якщо не `?seed=`) — тому для повтору потрібен `reseedBristleRandoms`.

**Гіпотези, ще не виміряні:**

- Квантування `xy: 64`, `height: 4096` тримає AC-REC-5 (≥ 99 % пікселів у межах ±2). Фаза 2 вимірює.

## НЕЗАКРИТЕ — почни звідси

~~1. Фаза 1 — `stepTick()` і швидкість Max (SPEC §1)~~ — ЗАКРИТО 2026-10-26.
Див. «Що зроблено», INV-MAX-1, `QA.md` §«Фаза 1». Відхилення від SPEC §1.2: числові
швидкості контролера ніколи не йшли через `ticksPerFrame` — вони timeline-режим; Max
реалізовано тим самим paced-порядком тіків з `BudgetTickScheduler` замість стелі 32, інакше
AC-MAX-2 неможливий. Legacy `ticksPerFrame` лишився (тести, `tilecraft-spot-gpu-test`).

### 1a. Стеля 32 оп/кадр у timeline-режимі (знахідка фази 1, не в жодній фазі)

`waitTimeline()` у `playPlan()` віддає кадр після 32 операцій незалежно від дедлайну, тож на
великих файлах 4×/8×/16× грають однаково (≈ 3,2× на fixture). Варіанти: стеля з
`targetDuration` (оп/кадр = потрібний темп), або `BudgetTickScheduler` і для числових швидкостей
з дедлайном. Зміна групування не змінює малюнок (INV-MAX-1), але змінює UX і `test:story-ui`
терпимість до тривалостей. Вирішує людина, коли і чи брати.

### 2. Фаза 2 — гачки рушія і spike детермінізму (SPEC §2.3)

**Контракт.** `setSessionObserver()`, `replayTick()` (через той самий `_tick()`),
`beginStroke({ variation })`, `reseedBristleRandoms(seed)`. Без UI та без кодека.

**Чому окремо і рано:** це найризикованіше рішення теми — чи взагалі можна
відтворити живий мазок із записаних цілей. Якщо ні, формат A і фази 3–4
треба переглядати, а не будувати поверх.

**Вже є з фази 1:** `_tick(previous, current, t)` і `stepTick()` — `replayTick()` має йти
через той самий `_tick()`, а обсервер — чіплятися в `_tick()`/`_finishTicks()`, не в `advance()`.

**Guard:** guard фази 1 (`test:story-max`, `test:timing`, `test:tilecraft`, `test:tilecraft:gpu`
з AC-MAX-2/3, `test:tilecraft:polyline:gpu`, `test:story-ui`, `test:live-gpu`, `build`) +
`test:bake`; `test:bristle-shape` падав до фази 1 — порівнювати з baseline, не вимагати зеленого.
Обсервер `null` не змінює жодного наявного тесту.

**Probe:** `debug/session-replay-gpu-test.js` — програмні live-мазки з
обсервером → перезапуск engine з тим самим seed → `replayTick` у трьох
варіантах: float без квантування, `xy:64/h:4096`, `xy:256`. Записати в
«Виміряні факти» частку пікселів у межах ±2 для кожного. Обрати кванти
(відкрите питання 3 SPEC) за числами.

**QA-чернетка:** не потрібна людині — фаза без UI; достатньо GPU-проби.

### 3. Фаза 3 — запис і Save (SPEC §2.1–2.4, §2.6, §2.7)

**Контракт.** `app/session-codec.js` (контейнер `"FLUS"`, теги, zigzag-varint,
прогноз 2-го порядку), `app/session-recorder.js` (typed-array блоки, команди
Paint, ліміт 432 000 тіків), картка **Session recording** першою у State:
Record/Stop, Save, Open… (поки disabled-заглушка або лише вибір файлу без
програвання), чіп `● REC` на полотні, baseline PNG, unsaved guard + `beforeunload`.

**Guard:** guard фази 2 + `test:story-ui`, `test:pwa-release` (нові файли
мають бути в git і gulp-глобах до прогону). Нові: `debug/session-codec-test.js`
(round-trip, розмір на синтетичному корпусі ≤ 4 Б/тік).

**Probe:** у браузері Record → 3 мазки + Undo → закрити панель (чіп REC видно,
запис іде) → Stop → Save; файл ≤ бюджету AC-REC-6; накладні витрати recorder
≤ 0,1 мс/кадр p95 (AC-REC-7).

**QA-чернетка.** State → Record → малювати 30 с → закрити панель → ще мазок →
відкрити → Stop → Save. Дивитись: статус `● REC mm:ss · N strokes · ~KB`,
чіп REC поза панеллю, файл `painting-session-*.flus`. Спробувати Record знову
без Save — inline-попередження Discard/Cancel.

### 4. Фаза 4 — Open і повтор у Player (SPEC §2.7 Open, §2.8)

**Контракт.** Open… парсить `.flus`, показує підсумок і `Open in Player →`.
Player програє сесію Exact-режимом через `replayTick`: швидкості `0.25×…16×`
і Max (scheduler фази 1), Replace/Add з baseline, progress за тіками/мазками,
Prev/Next і Import colors вимкнені/приховані, Thickness вимкнений,
IDLE-серії скорочуються до 60. Record вимкнений під час повтору сесії.

**Guard:** guard фази 3 + `test:story-recent`, `test:story-demo:ui`.

**Probe:** AC-REC-5 наскрізно через UI: Record → мазки → Save → reload →
Open → Play на Max → порівняння `exportPixels()` з PNG, збереженим до reload.
Мобільний layout State на 320 px (AC-REC-10).

**QA-чернетка.** Відкрити збережений `.flus` → Open in Player → Play 1×, потім
Restart на Max. Дивитись: темп 1× як у оригіналі, Max швидше, малюнок збігається
з оригіналом; Undo/Clear з запису відтворились.

### 5. Фаза 5 — опорні точки C і Vector-повтор (SPEC §2.5)

**Контракт.** На Save добудовується секція `KEYFRAMES` (RDP `ε = 0,5`, тиск
`|Δp| > 0,02` і екстремуми). Файл з іншим `engineContract` відкривається як
`Vector — approximate` і грає через replay-режим `strokeTo()`; Thickness
увімкнений. Без секції C — зрозуміла помилка.

**Guard:** guard фази 4 + `debug/session-keyframes-test.js`.

**Probe:** штучно змінений `engineContract` у файлі → Open показує
`Vector — approximate` і програє без винятків у консолі (AC-REC-9); точок C
у 5–10 разів менше, ніж тіків, на QA-корпусі.

## Відкриті питання

1. Чи приймати `.flus` і у вкладці File (drag-and-drop)? SPEC §7.1 — пропозиція
   «так, після фази 4»; не входить у жодну фазу, доки людина не вирішить.
2. Перемикач «Skip idle pauses» для `1×` чи лише жорстке скорочення до 60 тіків? (SPEC §7.2)
3. Остаточні кванти — вирішуються числами фази 2. (SPEC §7.3)
4. SPEC не визначає, що робить запис, якщо під час нього змінюють розмір
   painting rectangle перетягуванням: координати в системі painting, але
   Resize змінює саму систему. Перед фазою 3 вирішити: записувати Resize як
   команду й перераховувати наступні тіки, чи зупиняти запис на Resize.
5. SPEC §2.1 записує `paintPathSegment` зі story playback, але story під час
   запису ще й змінює `bristleCount` (`_applySpotBristleCount`) на час прогону —
   перевірити у фазі 3, що ця зміна теж потрапляє в запис командою.

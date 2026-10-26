# Handoff: fluid-session — швидкість Max і запис сесії малювання

Стан на 2026-10-26, гілка `feat/pwa`. Код теми ще не писався. Спека
[`docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md`](../../PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md)
(далі — SPEC) і цей файл ще не закомічені. Спирається на коміт `72cbcd7`
(GPU-шлях `paintPathSegment`, `randomizeBristles`, recent files).

> **Далі:** фаза 1 — `stepTick()` і швидкість Max.

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `fluid-engine/index.js` | `advance()` — живий годинник 60 Гц, ≤ 5 кроків на виклик; тіло циклу ще не винесене в окремий `_tick()`. |
| `app/story-playback-controller.js` | `setSpeed()` приймає `0.25…16`; fast-тік — `_advanceStoryTick()` з `max(storyClock, wallNow) + 1/60`. |
| `fluid-engine/tilecraft-stroke-player.js` | Fast-path через `ticksPerFrame` + `advanceTick` + `resetAdvanceClock`; slow-path через `framesPerStep`. |
| `index.html` | `#story-speed` має опції `0.25×…16×`; вкладка State (`#bake-page`) має картки Brush Angle і Bake. |
| `paint.js` | `save()` — PNG через anchor `download`; цей механізм перевикористовується для `.flus`. |

## Головні виміряні факти

Виміряне (статично, з коду та fixture 2026-10-26):

- Fixture `docs/story-2026-09-08-4-frames.json`: 22 720 тайлів, 1 955 380 Б,
  86 Б/точку; gzip — 360 649 Б (≈ 16 Б/точку). Це база для порівняння з AC-REC-6.
- Один крок симуляції: `Brush.update` з `ITERATIONS = 20` (≈ 80–100 draw calls)
  + 2 splat + 7 проходів рідини (divergence, clear, 2 jacobi, subtract, 2 advect).
  Рідина обробляє union-прямокутник splat-областей за `FRAMES_TO_SIMULATE = 60` кроків.
- `randomsTexture` заповнюється один раз у конструкторі `Brush` з `engine.random`
  (`Math.random`, якщо не `?seed=`) — тому для повтору потрібен `reseedBristleRandoms`.

**Гіпотези, ще не виміряні** (не цитувати як факт):

- Вузьке місце на 16× — CPU-накладні draw calls щетинок, а не fill рідини.
  Фаза 1 має це підтвердити або спростувати (ticks/s Max на desktop-QA).
- Квантування `xy: 64`, `height: 4096` тримає AC-REC-5 (≥ 99 % пікселів у межах ±2).
  Фаза 2 вимірює.

## НЕЗАКРИТЕ — почни звідси

### 1. Фаза 1 — `stepTick()` і швидкість Max (SPEC §1)

**Контракт.** Винести тіло циклу `advance()` у `_tick()`; публічний
`engine.stepTick()` робить рівно один крок із поточною live-ціллю. Story fast-path
переходить на інтерфейс `tickScheduler` (`FixedTickScheduler(N)`,
`BudgetTickScheduler` з AIMD, SPEC §1.3). `setSpeed('max')`, опція `Max` під
`16×`, `?storySpeed=max`, статус `Max ≈ N× · T ticks/s`, ETA з виміру.

**Guard:** `npm run test:timing`, `test:tilecraft`, `test:tilecraft:gpu`,
`test:tilecraft:polyline:gpu`, `test:story-ui`, `test:live-gpu`, `build` —
зелені без зміни очікувань. Нові: unit-тест scheduler (фейковий годинник:
старт K=16, зменшення ×0,7 після двох довгих кадрів, стеля 256).

**Probe:** GPU-тест, що для fixture `exportPixels()` після Max побітово
дорівнює 16× (AC-MAX-2), і тест зі штучною затримкою тіку > 16,7 мс:
`timingStats.steps === 1` (AC-MAX-3).

**QA-чернетка.** Відкрити `?story=1` → Player → Speed `Max` → Play.
Дивитись: статус показує `Max (measuring…)`, потім `Max ≈ N×`; Pause і ручний
мазок реагують одразу. Результат: картинка як на 16×, без зависань > 1 с.

**Новий інваріант:** INV-MAX-1 (fast-тік = рівно один `simulate()`).

### 2. Фаза 2 — гачки рушія і spike детермінізму (SPEC §2.3)

**Контракт.** `setSessionObserver()`, `replayTick()` (через той самий `_tick()`),
`beginStroke({ variation })`, `reseedBristleRandoms(seed)`. Без UI та без кодека.

**Чому окремо і рано:** це найризикованіше рішення теми — чи взагалі можна
відтворити живий мазок із записаних цілей. Якщо ні, формат A і фази 3–4
треба переглядати, а не будувати поверх.

**Guard:** усі guard фази 1 + `test:bristle-shape`, `test:bake`; обсервер `null`
не змінює жодного наявного тесту.

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

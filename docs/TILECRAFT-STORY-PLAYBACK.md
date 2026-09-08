# Tilecraft story playback у Fluid Paint

## Призначення

Ця фіча відтворює Tilecraft Story Model через публічний Stroke API
`FluidEngine`, щоб глядач бачив не миттєвий векторний імпорт, а появу рисунка
у симуляції рідкої фарби. Поточний демонстраційний сценарій навмисно прив'язаний
до checked-in fixture: це відтворюваний приклад, а не завантажувач довільних
URL.

Поточна fixture: `docs/story-2026-09-08-4-frames.json`.

## Швидкий запуск

Запустити development server і відкрити:

```text
http://127.0.0.1:8081/?story=1
```

Сторінка очистить полотно, піджене обраний кадр Story Model (або об'єднання
кадрів, якщо нічого не обрано) до поточного painting rectangle та почне
playback.

| URL-параметр | Значення | Поведінка |
|---|---:|---|
| `story=1` | — | увімкнути демонстрацію fixture |
| `storySpeed=N` | ціле `N > 0`, default `8` | прискорити модельний час у N разів: N повних Tilecraft/Fluid кроків на один показаний RAF |
| `storyFramesPerStep=N` | ціле `N > 0` | режим slow motion: один Tilecraft крок кожні N RAF; має пріоритет над `storySpeed` |

Приклади:

```text
?story=1&storySpeed=1             # базова, lossless live-швидкість
?story=1&storySpeed=8             # типовий fast-forward для великої історії
?story=1&storySpeed=16            # ще швидше, якщо GPU витримує
?story=1&storyFramesPerStep=4     # діагностичне уповільнення в 4 рази
```

Не поєднувати `storySpeed` та `storyFramesPerStep` в одному посиланні:
останній означає інший, повільний режим і навмисно вимикає fast-forward.

## Що саме відтворюється

1. Видимі `polyline` layers ідуть першими; `g` є логічним шляхом, `b` робить
   підняття пензля, а `gz` замикає шлях.
2. Видимі `polygon` layers ідуть після polyline як незалежні точки-мазки.
3. `s` керує нормалізованим pressure, а `gridSize * layer.scale` — базовою
   товщиною.
4. Для polyline товщина також враховує Tilecraft-корекцію `distance / gd`,
   responsive коефіцієнт canvas `min(1, max(width, height) / 3000)` та
   coordinate scale, використаний для перенесення XY у Fluid Paint.
5. `#RRGGBB[A]` — це display RGB. Адаптер знаходить найближче RYB-навантаження
   того ж pigment cube, що рендерить Fluid Paint; RGB не передається напряму як
   RYB. Наднасичені RGB-кольори, яких subtractive cube не має, апроксимуються
   найближчим досяжним кольором.

Детальний контракт API та приклад програмного виклику лишаються в
[`api-usecases.md`](api-usecases.md).

## Семантика швидкості та межі

`storySpeed` — не проріджування. На `storySpeed=8` adapter зберігає усі точки:
для кожної наступної точки він викликає `strokeTo()`, потім один фіксований
`advance(1/60)`. Після пачки clock повертається до wall clock, перш ніж
звичайний RAF застосунку продовжить роботу. Це не дає змішати синтетичний час
історії з реальним часом миші.

Отже, `8×` описує модельний час на один показаний кадр, а не обіцянку 8× меншого
wall-clock часу. Якщо GPU не може виконати вісім симуляційних кроків за один
display frame, браузер покаже менше FPS. Це свідомий вибір: не губити криві та
не змінювати контракт live-штриха непомітним skip/thinning.

Для вимірювання реальної швидкості потрібні два числа: виконані model ticks/s
і presentation FPS. Саме їх має показувати майбутній UI, а не лише обраний
множник.

## Перевірка

```text
npm run test:tilecraft       # mapping, RYB, gd/canvas width, slow та fast modes
npm run test:tilecraft:gpu   # запускає fixture зі storySpeed=8 у Chromium/WebGL
npm run build                # production bundle
```

GPU-probe перевіряє, що playback стартує без GL error. Він не є вимірюванням
плавності на конкретних GPU або великих полотнах.

## План UI

### P0 — керування вже реалізованим playback

Мета: URL більше не повинен бути основним інтерфейсом для перегляду історії.

1. Додати компактну, окрему від brush panel панель **Story playback**, яка
   з'являється лише після завантаження Story Model.
2. Додати `Play/Pause`, `Restart`, `Stop/Return to canvas` і selector швидкості
   `0.25×, 0.5×, 1×, 2×, 4×, 8×, 16×`. Значення нижче 1× використовують
   `storyFramesPerStep`; значення 1× і вище — `storySpeed`.
3. Показувати progress: `оброблено точок / всього`, номер кадру, активний layer
   та завершений/paused/error стан. Не підміняти прогрес числом RAF.
4. Показувати діагностику `model ticks/s`, FPS та selected speed. При GPU-bound
   8× UI має чесно показати, що фактична швидкість нижча за обрану.
5. На початку playback зробити snapshot полотна; `Stop/Return` відновлює його,
   `Restart` не накопичує фарбу поверх старої історії.

**Критерій готовності P0:** пауза не втрачає наступну точку, restart завжди
дає той самий порядок Tilecraft input, а звичайне малювання не може одночасно
мати активний story stroke.

### P1 — вибір контенту та кадрів

1. Додати безпечний picker локальних/дозволених story fixtures, без fetch URL
   від користувача за замовчуванням.
2. Показати список `frames` з thumbnails/назвою narrative; вибір одного кадру
   відтворює тільки його, “All frames” зберігає поточний collage-режим.
3. Додати preview bounds перед стартом: fit, contain/cover, background та
   очікувані розміри canvas.
4. Запам'ятовувати останню fixture, frame і speed у URL/локальному стані так,
   щоб посилання було відтворюваним.

**Критерій готовності P1:** користувач може вибрати кадр і швидкість без
DevTools, а пряме посилання відтворює той самий вибір.

### P2 — якість та продуктивність

1. Додати профілі `Faithful`, `Balanced`, `Fast`. Вони мають явно показувати,
   чи змінюють лише presentation cadence, чи якість/роздільність симуляції.
   Не називати проріджування “speed”, якщо воно колись буде дозволене.
2. Додати preflight estimate: кількість tiles/strokes, орієнтовну тривалість
   при 1×/8× та попередження про велике полотно.
3. Показати legend відображення кольорів: original RGB і фактичний RYB-display
   swatch, особливо для кольорів поза gamut.
4. Додати sampling-профіль до export/debug report: canvas size, resolution,
   chosen speed, actual ticks/s, dropped time, GPU/WebGL path.

**Критерій готовності P2:** користувач може пояснити, чому історія повільна
або чому колір відрізняється, без читання коду.

## Архітектурні обмеження для майбутнього UI

- Story controller має бути єдиним власником playback state. Поточні
  `window.playTilecraftStory` та debug globals можна зберегти для тестів, але
  UI не має керувати ними напряму.
- Потрібні явні `pause`, `resume`, `cancel`/`AbortSignal` у player scheduler.
  Не реалізовувати pause блокуванням JavaScript або накопиченням точок.
- При старті, паузі, stop і помилці controller мусить коректно завершувати
  активний Stroke API stroke та повертати engine clock до wall time.
- Поки active story playback існує, pointer dispatcher повинен або блокувати
  ручне малювання, або спершу поставити історію на паузу; паралельні strokes
  заборонені API.
- UI-параметри мають бути валідовані (`N` — скінченне додатне ціле), мати
  доступні labels/keyboard control та не закривати картину на narrow viewport.

## Відкриті рішення

1. Чи має `Stop` відновлювати snapshot, чи залишати вже намальовану частину?
   P0 пропонує відновлення; “залишити результат” можна зробити окремою дією
   `Keep`.
2. Чи можна додавати lossy Fast profile? Лише як окремий явно названий режим з
   вимірюваною втратою деталей; він не може змінювати `storySpeed`.
3. Чи потрібен імпорт стороннього JSON? Якщо так, потрібні schema validation,
   розмірні ліміти та локальний file picker, а не довільний remote URL.

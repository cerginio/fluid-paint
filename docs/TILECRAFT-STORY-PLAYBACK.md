# Tilecraft story playback у Fluid Paint

UI та product integration specification:
[`TILECRAFT-PLAYER-UI-SPEC.md`](TILECRAFT-PLAYER-UI-SPEC.md).

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
http://127.0.0.1:3000/?story=1
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

1. Tiles групуються за `f`, і кожен кадр малюється повністю перед переходом до
   наступного; порядок кадрів відповідає першій появі у render order.
2. Усередині кадру зберігається початковий layer/source render order, без
   перегрупування за кольором.
3. `g` є логічним шляхом і малюється кольором першого tile; `b` робить підняття
   пензля, `gz` замикає шлях, а `polygon` tiles лишаються окремими мазками.
4. `s` керує нормалізованим pressure, а `gridSize * layer.scale` — базовою
   товщиною.
5. Для polyline товщина також враховує Tilecraft-корекцію `distance / gd`,
   responsive коефіцієнт canvas `min(1, max(width, height) / 3000)` та
   coordinate scale, використаний для перенесення XY у Fluid Paint.
6. `#RRGGBB[A]` — це display RGB. Адаптер знаходить найближче RYB-навантаження
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
npm run test:story-ui        # file import, transport, jumps, registry та mobile layout
npm run build                # production bundle
```

GPU-probe перевіряє, що playback стартує без GL error. Він не є вимірюванням
плавності на конкретних GPU або великих полотнах.

## Реалізований UI та runtime

URL більше не є основним інтерфейсом. Кнопка `+` відкриває extension із
вкладками **File** та **Player**.

- **File** приймає локальний `.json` через picker або drag-and-drop, перевіряє
  кореневу структуру, типи drawable tiles, ліміт 25 MB і максимум 500 000
  tiles. Після перевірки показує frames, groups, drawable items, bounds та
  попередження про пропущений контент.
- **Player** має `Play/Pause/Resume`, `Restart`, `Stop`, вибір швидкості
  `0.25×…16×`, live-множник товщини `0.1×…1.2×` (default `1×`) та політику
  `Replace current painting` / `Add over current painting`. Зміна speed або
  thickness під час `Playing` застосовується через safe scheduler hand-off із
  поточного playhead; painted registry не дозволяє повторне нанесення.
  Фінальний розмір пензля обчислюється як
  `calculatedBrushSize × 0.5 × brushSizeMultiplier`; UI-множник за замовчуванням
  дорівнює `1`.
- На старті controller зберігає baseline. Після `Stop` користувач явно обирає
  `Restore canvas` або `Keep partial`; `Restart` відновлює baseline і не
  накопичує попередній прогін.
- `Previous/Next Frame` циклічно працюють по межах immutable
  compiled plan. Стрибок уперед лише змінює playhead і позначає пропущену
  частину; в обох напрямках вибираються тільки pending-діапазони. Після
  останнього кадру Next переходить до першого, а Previous перед першим — до
  останнього.
- `UnpaintedRangeRegistry` зберігає нормалізовані half-open діапазони окремо
  від DOM та engine. `TilecraftStrokePlayer.playPlan()` перевіряє registry
  перед кожною операцією, тому нанесена фарба не дублюється.
- Paint controls і canvas ніколи не стають `inert` через story. Початок
  ручного жесту атомарно завершує поточний story stroke, ставить playback на
  паузу і відразу передає brush користувачу. `Clear`, `Undo` та `Redo` мають ту
  саму arbitration-поведінку. Якщо story уже завершена або очікує рішення,
  ручна дія трактує видимий результат як `Keep result`.
- Закриття extension ставить playback на паузу.
- Панель має ARIA tabs і keyboard navigation; на viewport до 640 px вона стає
  bottom sheet з touch targets не менше 44 px.

Стан `Completed` досягається лише з порожнім registry. Якщо playhead дійшов до
кінця, але після стрибків залишились прогалини, controller переходить у
`completed-with-gaps` та пропонує домалювати найраніший pending range або
свідомо залишити неповний результат.

Ще не реалізована runtime-телеметрія `model ticks/s` і presentation FPS. UI
показує обраний multiplier та точний operation coverage, але не видає обрану
швидкість за фактично досягнуту.

## Подальший план

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
- Якщо під час active story playback починається ручне малювання, pointer
  dispatcher спершу має дочекатися safe pause/cleanup історії; блокувати canvas
  не можна, а паралельні strokes заборонені API.
- Перед playback модель компілюється у стабільний лінійний plan із межами
  `group`/`frame`. Registry оперує half-open діапазонами індексів цього plan,
  а не сирими індексами `tiles`, які не враховують layer order і `b`-розриви.
- Back-навігація не є rewind полотна: вона знаходить попередній перетин
  frame з pending registry і малює тільки непромальований піддіапазон.
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

# QA: fluid-session — швидкість Max і запис сесії

Локальний запуск: у `D:\work\fluid-paint\fluid-paint` виконати `npm run dev`. Команда
збирає `dist/` і піднімає сервер на `http://127.0.0.1:3000/`. Інтернет не потрібен.
Fixture для сценаріїв лежить на диску: `D:\work\fluid-paint\fluid-paint\docs\story-2026-09-08-4-frames.json`
(25 871 операція). Сервер `dist/` його не роздає, тому `?story=1&storySpeed=max` на dev-сервері
не працює. Цей шлях покриває `npm run test:tilecraft:gpu` (сторінка з кореня репо).

Довідкові числа з desktop-QA (AMD Radeon 890M, D3D11, 2026-10-26), повний fixture:
1× за планом — 43,0 с; 16× — 13,5 с (1 918 оп/с); Max — 3,8 с (6 838 оп/с).

## Фаза 4 — Open і повтор у Player (SPEC §2.7 Open, §2.8) — прийнято 2026-10-27

Журнал: Open… показує `Open in Player →`; Player програє `.flus` точно, тік за тіком
(`app/session-player.js`). Record тепер стартує з того стану, з якого стартує повтор: непорожнє
полотно запікається у фон, порожнє — без швидкості рідини (без цього повтор поверх малюнка давав
0,934 пікселів у ±2). Браузерні сценарії — на `npm run dev` (`http://127.0.0.1:3000/`), інтернет не
потрібен. Для P2–P7 потрібен файл `.flus`: записати за QA-S2–S6 (з Undo) і дати рідині осісти
секунду перед `■ Stop`. Покриття автоматом: P1–P8 і P10 проходить `npm run test:session-ui`
(повтор після перезавантаження побітово рівний оригіналу), P9 — те саме на справжньому GPU.
Очима — те, чого автомат не бачить: темп 1× проти оригіналу, плавність Max, що полотно на паузі
справді завмирає, зум вигляду у вузькому вікні. Власник прийняв фазу через `handoff:next`.

### QA-P1. Open… пропонує Open in Player

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** `+` → вкладка `State` → `Open…` → обрати збережений `painting-session-….flus`.
**qa:inspect:** текст під кнопками Save/Open… і кнопка під ним.
**qa:expected:** `painting-session-….flus: 00:mm · N strokes · T ticks · K KB · Exact · starts from
an empty canvas.` (без колишнього «arrives in the next update»), під ним широка зелена кнопка
`Open in Player →`. Для зіпсованого файлу (`x.flus`) — червоний текст помилки, кнопки немає.

### QA-P2. Player показує сесію

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-P1.
**qa:action:** `Open in Player →`.
**qa:inspect:** вкладка Player: назва, рядок під нею, лічильник прогресу, контроли.
**qa:expected:** відкрилась вкладка `Player`. Назва — ім'я файлу; під нею
`Session recording · Exact · 00:mm · N strokes`. Лічильник `0 / T ticks · 0 / N strokes`
(T — усі тіки повтору: мазки плюс холості паузи). Блоку `Import colors` немає; повзунок
`Thickness` сірий (вимкнений), кнопки `⏮ Frame` / `Frame ⏭` вимкнені, рядок над ними —
`Session — no frames`.

### QA-P3. 1× — темп оригіналу, Record вимкнений

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-P2.
**qa:action:** `Paint onto canvas` → `Replace current painting`; `Speed` → `1×`; `Play`. Поки грає —
вкладка `State`, навести курсор на `● Record`.
**qa:inspect:** полотно; статус Player; кнопка Record і її підказка.
**qa:expected:** полотно очищується, мазки з'являються в тому порядку й тому темпі, як малювались
(довгі паузи між мазками скорочені до ≈ 1 с). Статус `Replaying session…`. `● Record` вимкнений,
підказка `A session is replaying in the Player: stop it first.` Мазок, відмінений Undo в
оригіналі, з'являється і в момент Undo зникає.

### QA-P4. Пауза заморожує рідину

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` під час QA-P3, щойно після мазка.
**qa:action:** `Pause`, дивитись на полотно 3 секунди, потім `Resume`.
**qa:inspect:** мокра фарба щойно намальованого мазка.
**qa:expected:** на паузі фарба не розтікається далі — кадр нерухомий. Після `Resume` розтікання
продовжується з того самого місця, а повтор — з наступного тіку.

### QA-P5. Max і завершення

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-P2 або QA-P3.
**qa:action:** `Speed` → `Max` → `Restart` (або `Play`).
**qa:inspect:** статус Player, лічильник, полотно після завершення.
**qa:expected:** статус спершу `Playing · Max (measuring…)`; якщо повтор довший за ~1 с —
`Playing · Max ≈ N× · T ticks/s · S s left`, і S рівно спадає. Тік сесії — повний крок пензля й
рідини, тож Max обмежений GPU: на Radeon 890M щільна сесія йде ≈ 4× (≈ 230–265 ticks/s), не
десятки разів, як story. Полотно оновлюється плавно, без замирань на секунди. Короткий запис
(кілька мазків) закінчується раніше, ніж з'явиться `≈ N×`, — це нормально. Кінець: статус
`Playback completed.`, лічильник `T / T ticks · N / N strokes`, `● Record` знову увімкнений.

### QA-P6. Повтор після перезавантаження збігається з оригіналом

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** записати 3–4 мазки з `Undo` і `Clear` посередині (QA-S2), дати осісти 1 с, `■ Stop`,
`Save`, зробити скріншот полотна. Перезавантажити сторінку (F5). `Open…` → цей файл →
`Open in Player →` → `Replace current painting` → `Max` → `Play`.
**qa:inspect:** полотно після `Playback completed.` поруч зі скріншотом.
**qa:expected:** малюнок той самий до пікселя на око: ті самі мазки, ворсинки, розтікання;
відмінений Undo мазок відсутній, Clear стер те, що стер в оригіналі.

### QA-P7. Сесія поверх малюнка: baseline як фон

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** намалювати щось → `State` → `current painting as background` → `● Record` → мазок
поверх → `■ Stop` → `Save`. Перезавантажити → `Open…` → файл → `Open in Player →` →
`Replace current painting` → `Max` → `Play`.
**qa:inspect:** полотно відразу після Play і після завершення; підсумок у State після `Open…`.
**qa:expected:** при `● Record` полотно на вигляд не змінилось (малюнок запікся у фон, примітка
`Started over the current painting…`). Підсумок файлу — `starts over a background`. Після Play
одразу з'являється малюнок до Record як фон, потім поверх нього — записаний мазок; результат
збігається з оригіналом.

### QA-P8. Вужче вікно — вигляд зменшується, координати ні

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` у вікні браузера, вужчому за вікно запису (наприклад
700×520 проти 1100×760).
**qa:action:** `Open…` → файл з QA-P6 → `Open in Player →` → `Replace current painting` → `Max` →
`Play`.
**qa:inspect:** полотно.
**qa:expected:** painting rectangle цілком видно: вигляд зменшено (≈ 0,6 для 700×520), полотно по
центру. Мазки там само відносно країв painting, що й в оригіналі; нічого не обрізано.

### QA-P9. Повтор точний на справжньому GPU

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `node debug/session-recording-ui-test.js --hardware`
**qa:inspect:** чотири рядки `"check":"replay"` і підсумок.
**qa:expected:** у кожному `"withinTwo":1` (AC-REC-5 вимагає ≥ 0,99), `"pausedSteps":0` у рядку
`empty`, `"viewScale"` < 1 у `small-window`; підсумок `session-recording-ui: 18 checks passed`,
код виходу 0.

### QA-P10. 320 px: Open in Player і Player

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` у DevTools device mode 320×640.
**qa:action:** `+` → `State` → `Open…` → файл → `Open in Player →`.
**qa:inspect:** картка Session recording, потім вкладка Player.
**qa:expected:** `Open in Player →` на всю ширину картки, не нижча за 44 px; горизонтальної
прокрутки немає ні в State, ні в Player.

### Свідомо не зроблено у фазі 4

- **Vector-повтор** файлу з іншим `engineContract` — фаза 5. Такий файл Open… показує з текстом
  `Approximate replay arrives in a later update.`, кнопки `Open in Player →` немає.
- **Prev/Next Frame** для сесії вимкнені назавжди у v1 (SPEC §2.8).
- **`.flus` у вкладці File** (drag-and-drop) — відкрите питання 1, не вирішене.
- **Undo після повтору**: повтор починає з порожньої undo-історії (так вимагають записані Undo),
  тож весь прогін не відміняється одним Undo, як story.
- **Add over current painting** програє поверх наявної фарби: це не точний повтор за визначенням;
  painting однаково стає в прямокутник запису.
- **Story Max** лишився на `BudgetTickScheduler` фази 1: темп від GPU-fence отримав лише повтор
  сесії, чиї тіки важкі. Story на fixture не замирала (виміряно у фазі 1).
- **AC-REC-6 на ручному корпусі ≥ 1 хв** не виміряний: є лише короткі записи (356 тіків — 1 265 Б,
  ≈ 3,6 Б/тік з заголовками). Якщо при QA-P6 записати хвилину, розмір файлу з підсумку Open… дасть
  це число.

## Фаза 3 — запис і Save (SPEC §2.1–2.4, §2.6, §2.7) — прийнято 2026-10-26

Журнал: картка **Session recording** першою у вкладці State, чіп `● REC`, Save у `.flus`,
unsaved guard, Open… поки лише читає файл і показує підсумок (програвання — фаза 4). Тіки —
float32 без втрат (рішення 2a); Resize завершує запис (відкрите питання 4). Браузерні сценарії —
на `npm run dev` (`http://127.0.0.1:3000/`), інтернет не потрібен (Demo-вкладка без інтернету
порожня, це не стосується фази). Власник пройшов сценарії на стенді `npm run dev` і прийняв фазу
через `handoff:next`. Покриття автоматом: S1–S9 проходить
`npm run test:session-ui` (SwiftShader), S10 — `npm run test:session-replay:gpu`, S11 —
`npm run test:session-codec`. Очима варто подивитись те, чого автомат не бачить: чіп над
полотном, читабельність статусу, поведінку справжньої миші/пера.

### QA-S1. Картка Session recording перша у State

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** кнопка `+` на компактній панелі → вкладка `State`.
**qa:inspect:** верх вкладки State.
**qa:expected:** перша картка — `Session recording`, статус `Not recording`, широка зелена
кнопка `● Record`, під нею `Save` (вимкнена) і `Open…` (увімкнена) в одному ряду. Нижче —
`Brush Angle` і `Bake current painting`, як раніше. Блоку `Starts from` немає (полотно порожнє).

### QA-S2. Record вмикає статус і чіп REC

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** `+` → `State` → `● Record`.
**qa:inspect:** статус картки; верх полотна по центру.
**qa:expected:** кнопка стала `■ Stop`, статус червоний `● REC 00:00 · 0 strokes · ~1 KB`,
таймер щосекунди росте; `Save` і `Open…` вимкнені; під кнопками — `Undo history starts here.`
Над полотном по центру зверху — чіп `● REC` з червоною крапкою.

### QA-S3. Закриття панелі не зупиняє запис

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-S2 (запис іде).
**qa:action:** `×` у шапці панелі розширень → намалювати 3 мазки мишею → клавіша `Z` (Undo) →
ще один мазок → клік по чіпу `● REC`.
**qa:inspect:** чіп під час малювання; вкладка після кліку по чіпу; статус картки.
**qa:expected:** чіп `● REC` видно весь час, поки панель закрита. Клік по чіпу відкриває панель
одразу на вкладці State. Статус `● REC mm:ss · 4 strokes · ~N KB` (N — одиниці КБ).

### QA-S4. Stop: записано, не збережено

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-S3.
**qa:action:** `■ Stop`.
**qa:inspect:** статус картки, кнопки, чіп.
**qa:expected:** за мить статус `Recorded mm:ss · 4 strokes · N KB — not saved`, кнопка знову
`● Record`, `Save` і `Open…` увімкнені, чіп зник. З'явився блок `Starts from` з двома
варіантами: `current painting as background` (обраний) і `clear canvas first`.

### QA-S5. Незбережений запис не губиться мовчки

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` у стані QA-S4 (`— not saved`).
**qa:action:** `● Record` → `Cancel`; потім `Open…` → `Cancel`; потім закрити вкладку браузера.
**qa:inspect:** картка після кожного кліку; діалог браузера при закритті.
**qa:expected:** після `● Record` і після `Open…` у картці з'являється жовтий блок
`Unsaved recording will be discarded` з `Discard` / `Cancel`; запис не почався, файловий діалог
не відкрився. `Cancel` прибирає блок, статус лишається `— not saved`. Закриття вкладки показує
стандартне браузерне попередження «Leave site?».

### QA-S6. Save дає файл .flus

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` у стані QA-S4.
**qa:action:** `Save`.
**qa:inspect:** завантаження браузера; статус картки.
**qa:expected:** завантажено `painting-session-YYYYMMDD-HHMM.flus` (дата й час початку запису),
розмір — одиниці КБ на 4 мазки. Статус `Saved painting-session-….flus`. Тепер `● Record`
стартує без попередження.

### QA-S7. Record поверх намальованого — baseline

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` після QA-S6 (на полотні є фарба).
**qa:action:** у `Starts from` лишити `current painting as background` → `● Record` → Undo-кнопка
на панелі.
**qa:inspect:** примітка під кнопками; полотно після Undo.
**qa:expected:** примітка `Started over the current painting: it is kept as a flat background,
so new paint will not mix wet with it. Undo history starts here.` Undo нічого не відкочує
(історія почалась з Record), фарба до Record лишається.

### QA-S8. Resize завершує запис і зберігає його

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/` під час запису (QA-S7).
**qa:action:** намалювати мазок → потягнути правий край painting rectangle й відпустити.
**qa:inspect:** статус і примітка картки, чіп.
**qa:expected:** запис зупинився сам: статус `Recorded mm:ss · 1 strokes · N KB — not saved`,
примітка `Recording stopped: the painting was resized. What was recorded is kept.`, чіп зник.
Розмір файлу більший, ніж у QA-S6: у ньому baseline PNG.

### QA-S9. Open… показує підсумок файлу

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:3000/`
**qa:action:** `+` → `State` → `Open…` (у стані `— not saved` спершу `Discard`) → обрати файл
з QA-S6. Потім `Open…` → будь-який не-`.flus` файл, перейменований на `x.flus`.
**qa:inspect:** текст під кнопками.
**qa:expected:** для файлу з QA-S6:
`painting-session-….flus: 00:mm · 4 strokes · N ticks · M KB · Exact · starts from an empty canvas.`
і кнопка `Open in Player →` (з фази 4). Для підробленого — червоний
`x.flus: Session file: this is not a Fluid Paint session (.flus) file.` Помилок у консолі немає.

### QA-S10. Файл відтворюється так само точно, як float32-тіки

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:session-replay:gpu` (на справжньому GPU —
`node debug/session-replay-gpu-test.js --hardware`).
**qa:inspect:** рядки `"check":"codec"` і `"variant":".flus codec round trip"`.
**qa:expected:** `.flus codec round trip` — `"withinTwo":1`, `"maxDelta"` 0 або 1, хеш той самий,
що у `float32 ticks`. Рядок `codec` — розмір файлу цього крихітного корпусу (163 тіки,
≈ 11 Б/тік через заголовки мазків). Код виходу 0.

### QA-S11. Кодек, recorder і бюджет розміру

**qa:mode:** cli
**qa:open:** термінал, каталог `D:\work\fluid-paint\fluid-paint`.
**qa:action:** `npm run test:session-codec`
**qa:inspect:** рядок `"check":"size"` і підсумок.
**qa:expected:** `session-codec: 10 checks passed`; у `size`: `tickBytesPerTick` ≈ 8,2 (≤ 9),
`fileBytesPerTick` ≈ 6,7, `fileKBper36000` ≈ 235 (≤ 300). Код виходу 0.

### Свідомо не реалізовано у фазі 3

- Програвання `.flus` у Player, Replace/Add, baseline як фон при повторі — фаза 4. Open… лише
  перевіряє файл і показує підсумок.
- Секція C (`KEYFRAMES`) і `Vector — approximate` — фаза 5. Open… файлу з іншим
  `engineContract` поки каже, що наближеного повтору немає.
- Record вимкнений, поки story грає або на паузі (підказка в `title`): запишіть Record → Play.
- Зміна фону (File → background, story-сцена з PNG) завершує запис так само, як Resize.
- Розмір на справжньому ручному корпусі ще не виміряний — лише синтетика й 4 мазки QA.

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

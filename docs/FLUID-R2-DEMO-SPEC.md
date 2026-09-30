# Fluid Paint: демо історій із R2

**Статус:** спека для реалізації. **Дата:** 2026-09-30. **Застосунок:** самостійний Fluid Paint (`https://fluid-paint.netlify.app/`). Це читання R2 без Tilecraft Editor, `Fluid Play`, `Fluid Rescript`, iframe, message API чи облікових даних R2 у браузері. Цей документ не змінює handoff і не публікує об'єкти.

## 1. Мета та поточна основа

У розширеній панелі Fluid Paint додати вкладку **Demo** перед **File**. Demo читає публічний index із R2, дає вибрати slug історії та кнопкою **Run** запускає її в наявному Player з переходом на вкладку Player. File з локальним JSON/PNG і State зберігають свої сценарії.

Наявний шлях локального файлу: `app/ui/story-tools.js` → `StoryPlaybackController.loadFile()` → `StoryFileLoader.load()` / `summarize()` → `StoryPlaybackController.loadModel()`; відтворення починає `StoryPlaybackController.play()`. Перемикання вкладок робить `ToolPanel.selectExtensionTab()`. R2 Demo має ділити з File **валідацію, модель і Player controller**, а не створювати другого плеєра. Поріг локальної моделі зараз 25 MiB і 500 000 тайлів (`app/story-file-loader.js`); R2-модель проходить ті самі межі й правила.

## 2. Дані й адреси

Початкове джерело — канонічні fixture в репозиторії `ua-dream`:

| Об'єкт | Призначення | Стан fixture 2026-09-30 |
| --- | --- | --- |
| `tilecraft/viewer/engines/three/fixtures/catalog/index.json` | index, `schemaVersion: 1` | 763 байти, 3 записи |
| `story-8-frames-polygon.json` | модель polygon | 4 095 097 байтів, 8 кадрів, 2 шари |
| `story-8-frames-polyline.json` | модель polyline | 4 094 566 байтів, 8 кадрів, 2 шари |
| `story-8-frames-hibrid.json` | гібридна модель | 4 093 329 байтів, 8 кадрів, 2 шари |

`hibrid` — точний існуючий slug, його не перейменовувати під час публікації. Index містить `slug`, `title`, `frameCount`, `sizeBytes`, `credit`, `publishedAt`; UI показує назву, а значення option — slug. Список керується index: початкові три записи є даними для першої публікації, не трьома вшитими option у коді Fluid Paint.

**Публічний шлях першого випуску:** `https://cdn.storytilecraft.cc/fluid-demo/`. Під цим префіксом опублікувати чотири файли вище без зміни їхнього JSON. Index кладеться після трьох моделей, щоб жоден запис не вказував на 404. Основна й тимчасова резервна бази URL задані в коді; клієнт будує лише `${BASE}index.json` і `${BASE}<validated-slug>.json`, не приймає URL із index або введений користувачем host. Bucket `stories` та CDN вже існують, але наявний `/public-test/` належить каталогу Tilecraft Editor і **не перезаписується**. Перенесення префікса чи домену є окремою конфігураційною зміною з перевіркою об'єктів і CORS.

**Фактична перевірка до реалізації, 2026-09-30:** публічна адреса `r2.dev` для `/public-test/index.json` повернула 713 байтів та slug `frog-fairy-full`, `frog-fairy-2fr`, `squirrel-ginger-8fr`; `/public-test/story-8-frames-hibrid.json` повернув `404`. У відповіді на `Origin: https://fluid-paint.netlify.app` не було `Access-Control-Allow-Origin`. Отже наявність CDN provider **не означає**, що ці три scene уже опубліковані або доступні браузеру Fluid Paint.

**Тимчасовий обхід після публікації, 2026-09-30:** у мережі власника DNS для `cdn.storytilecraft.cc` може вести на Whalebone sinkhole, і браузер відхиляє його сертифікат. За контрактом `ua-dream/tilecraft/_docs/r2-story-catalog-spec.md` Demo повторює index або модель на `https://pub-17dfba1e4d9148e7bcd3547a717794f9.r2.dev/fluid-demo/` тільки коли `fetch()` CDN відхиляється через мережу. HTTP 404/5xx, невалідний JSON, помилка схеми та скасування запиту не перемикають джерело. `/public-test/` лишається окремим каталогом Tilecraft. `r2.dev` є тимчасовим development URL; придатний production маршрут для ураженої мережі ще потрібно визначити.

## 3. Контракт R2 і браузера

1. Bucket CORS дозволяє `GET` із `https://fluid-paint.netlify.app`, `http://localhost:3000` і `http://127.0.0.1:3000`. Це додається до наявних origin, потрібних Tilecraft; чинні правила не стирати. Якщо production host Fluid Paint зміниться, додати його точно, без `*`. Перевірити **GET з Origin** для index та кожної моделі на фактичному CDN, а не лише відкриття URL у вкладці чи HEAD.
   Перед релізом окремо перевірити TLS-доступність `cdn.storytilecraft.cc` у мережі власника: раніше цей домен давав `ERR_CERT_AUTHORITY_INVALID` у Tilecraft. Якщо проблема лишається, налаштувати production custom domain із чинним сертифікатом до ввімкнення Demo; `r2.dev` не вважати постійним розв'язанням.
2. Index віддається як JSON, `schemaVersion === 1`; не більше 200 записів і 128 KiB. Перевірити масив `stories`, унікальні slug за `^[a-z0-9]+(?:-[a-z0-9]+)*$` довжиною до 80, непорожню назву, додатні `frameCount`/`sizeBytes` та коректні дати. Невідомий schemaVersion або зіпсований запис відхиляє весь новий index. Текст із R2 виводити через `textContent`/`new Option`, не HTML.
3. **Refresh index** робить `GET ${BASE}index.json` із `cache: 'no-cache'`, блокується на час запиту та показує «Updating…», потім кількість демо й час останнього успіху. Перший вхід на Demo запускає один такий запит; далі запити лише кнопкою. На мережеву/HTTP/CORS/JSON/схемну помилку залишити останній валідний список у пам'яті, показати помилку; якщо списку ще немає, dropdown порожній і Run неактивний. Моделі не кешувати в `localStorage`.
4. Вибір slug у dropdown сам по собі не завантажує 4 MB JSON і не змінює Player. Run блокується під час fetch/parse/validate/start. Модель отримувати лише з перевіреного slug; перевіряти `response.ok`, тип JSON, `Content-Length` за наявності й фактичну кількість прочитаних байтів до `JSON.parse`. Межа — 25 MiB; для великих відповідей читати потік з byte cap, щоб не накопичувати довільно великий body. Застосувати ті самі preflight правила `StoryFileLoader`, що для File, включно з drawable summary й попередженнями. Розмір/кількість кадрів із index — інформаційні, не заміна валідації моделі.
5. Не створювати в браузері R2 ключів, Worker admin API, proxy або довільного remote URL input. У цьому випуску Demo — лише публічне читання. Файли в R2 мають бути доступні без Cloudflare Access; адмінський host фази F Tilecraft для цього не потрібен.

## 4. UI Demo

Порядок вкладок: **Demo | File | Player | State**. Нова кнопка `role=tab` і сторінка `role=tabpanel` користуються тим самим `ToolPanel` механізмом `data-extension-tab/page`, стрілками/Home/End і фокусом. Оновити `aria-controls` grip, коли додається сторінка. На вузькому екрані вкладки та кнопки лишаються видимими й доступними за чинним layout extension.

```text
Demo
  Story demos                         [ Refresh index ]
  [ Story Rombs (polygon)          ▾ ]
  8 frames · 4.1 MB · Tilecraft fixtures
  Last update: … / status or error
  [ Run ]
```

Option показує `title`, а під ним — метадані вибраного запису: slug, кадри, розмір і credit. Порожній валідний index показує «No demos yet». На початковій помилці — зрозуміла дія **Retry** через ту саму кнопку. Статуси мають `aria-live`; зміна dropdown не переносить фокус і не запускає playback. File не змінює своєї форми локального імпорту.

### Натискання Run

1. Якщо Player уже `playing`, `paused`, `stop-decision`, `completed`, `completed-with-gaps` або `player-error` із невирішеним результатом, Run не підміняє модель і пояснює, що спочатку потрібно завершити/вирішити поточне відтворення в Player. Не відкидати baseline чи partial painting мовчки.
2. Для вільного Player завантажити й перевірити модель **до** `loadModel()`. На помилку залишити стару модель, canvas, вибір dropdown і вкладку Demo; показати повідомлення в Demo. Пізня відповідь від старішого Run/Refresh не може перезаписати новіший вибір чи стан.
3. Після успішної перевірки викликати `controller.loadModel(model, summary)`, далі `toolPanel.selectExtensionTab('player', true)`, далі `controller.play()`. Run означає **автоматичний старт**, а не лише підготовку Player. `canvasPolicy`, speed і thickness беруться з чинних Player controls; типовий `replace` робить snapshot за наявним контрактом Player. Progress і Pause/Stop/Restart працюють як для локального файлу. Ім'я в Player — назва демо або `<slug>.json`, із доступним slug у summary.
4. Якщо запуск відхилений до першої операції, показати помилку на Player і залишити модель доступною для повтору Play. Якщо помилка виникла після нанесення фарби, зберегти штатне рішення Player щодо partial result/restore. Не запускати другий `TilecraftStrokePlayer` поряд з контролером.

## 5. UI preset API та межа реалізації

Додати feature id `demo-r2` у `app/ui/preset-api.js`: у `mode=full` вкладка Demo видима; у `mode=features`/`preset` вона доступна тільки при явному `demo-r2` **разом із** `player`. Конфігурація `demo-r2` без `player` відхиляється зрозумілою помилкою залежності. Пресети `draw-min`/`draw-full`, `empty` та наявні `file-bg`, `file-play`, `state-bake` зберігають свій склад і поведінку. У вбудованому `uiMode=empty` ніякого Demo UI чи автоматичного R2 запиту немає. Додати тести нормалізації/DOM видимості для нового feature.

Основні файли Fluid Paint: `index.html` (таб і панель), `app/ui/story-tools.js` (події/стан), окремий невеликий catalog client у `app/` (мережа й валідація), `app/story-file-loader.js` (спільний preflight), `app/ui/preset-api.js` (feature gating), `app/layout.css` (адаптивність), `gulpfile.js` (порядок нового скрипта в bundle), `debug/story-player-ui-test.js` і нові цільові тести. Зміни Tilecraft Editor, gamifier bridge та vendored message API не потрібні. На боці `ua-dream` потрібні лише перевірка канонічних fixture й публікація їх копій у R2 разом із CORS; fixture не переносити в репозиторій Fluid Paint як другу підтримувану копію.

## 6. Приймання і порядок виконання

| Код | Дія | Очікуваний результат |
| --- | --- | --- |
| FD-1 | Відкрити самостійний Fluid Paint у full UI | Вкладки `Demo | File | Player | State`; File/Player/State працюють як раніше. |
| FD-2 | Відкрити Demo після публікації, дочекатись index або натиснути Refresh | У списку три назви, їхні value — точні slug `story-8-frames-polygon`, `story-8-frames-polyline`, `story-8-frames-hibrid`; статус показує `3` і час. |
| FD-3 | Обрати кожен slug і натиснути Run | Модель читається з `${BASE}<slug>.json`, вкладка Player активна, статус `Painting story…`, progress зростає; summary показує 8 кадрів. |
| FD-4 | Натиснути Pause, Resume, Stop та Restore | Чинні Player controls діють на R2-модель; попередній canvas можна відновити. |
| FD-5 | Зламати мережу, CORS, index, slug/model JSON або перевищити ліміт | Помилка у Demo; раніше завантажена модель і canvas не змінені; Run не лишається заблокованим. |
| FD-6 | Refresh після успішного списку повертає помилку | Попередні option залишаються, статус показує невдале оновлення. |
| FD-7 | Відкрити `uiMode=empty`, `draw-min`, `features` без `demo-r2` | Немає Demo tab і R2 запитів; конфігурація `demo-r2` без `player` має явну помилку. |
| FD-8 | Перевірити `https://fluid-paint.netlify.app/` та `http://localhost:3000` браузером | Index і всі три моделі мають CORS для відповідного origin; Demo працює без Tilecraft Editor. |

Порядок: (1) з кореня `ua-dream` виконати `node tilecraft/scripts/story-catalog-index.mjs --check` і звірити валідність трьох fixture; (2) додати CORS origin Fluid Paint, опублікувати моделі, потім index у `/fluid-demo/`, перевірити live GET; (3) реалізувати catalog client і тести; (4) додати Demo UI/preset gating та браузерну пробу; (5) прогнати `npm run test:story-ui`, `npm run test:ui-preset`, `npm run test:tilecraft`, `npm run build` і ручний сценарій на standalone Netlify. Зміни іншого репозиторію та зовнішні R2 записи робити як окремі reviewable кроки.

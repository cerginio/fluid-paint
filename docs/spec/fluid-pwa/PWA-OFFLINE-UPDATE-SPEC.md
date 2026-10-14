# Fluid PWA — offline shell та надійні оновлення

Дата: 2026-10-14.
Статус: специфікація для review; реалізацію, deploy і commit не авторизовано
цим документом. Тема: `fluid-pwa`. Baseline: `55ed4a4`.
Ревізія 2 (2026-10-14): закрито зауваження spec review — retention (§4.1),
multi-tab activation (§6), font/icon рішення (§3.2), CORS межі scope C (§7),
PWA-придатний QA serving (§8A, §9).

## 1. Мета й межі

Після успішної підготовки offline Fluid Paint має запускатися без мережі.
Новий release завантажується повністю, не змішується зі старим і застосовується
лише безпечним переходом за згодою користувача.

Перший delivery scope — offline shell + detection/update (A+B). Offline demos
(C) — окреме розширення. Release QA (D) обов'язкова для кожного delivery.
Це порядок залежностей, не створений HANDOFF і не дозвіл реалізовувати фази.

Локальний repo: `D:/work/fluid-paint/fluid-paint`.
Production origin: `https://fluid.storytilecraft.space`.
A–C теми `fluid-2` та її release follow-up не перевідкривати.
Engine physics, палітри та vendored Tilecraft transport/model/bridge не міняти.

Не входять: background sync із сервером, робота зовнішнього editor offline,
повне збереження wet GPU state/Undo, автоматична міграція старих pigment textures,
автоматичний prod deploy, гарантія вічного зберігання browser storage.

## 2. Перевірена вихідна ситуація

- Gulp будує `dist/index.html`, `dist/bundle.js`, `dist/app/layout.css`.
- Production bundle вже містить GLSL registry; shader XHR дорівнює нулю.
- HTML посилається на Google Fonts; offline shell не може залежати від них.
- `app/story-demo-catalog.js` завантажує index/stories із CDN/R2 з валідацією.
- `netlify.toml` задає build/publish, але не PWA cache headers.
- Попередній scoped audit fluid-2 знайшов in-memory history/story textures,
  імпорт story JSON/PNG та export PNG, але не persistent wet-material restore.
  Не припускати наявність повного checkpoint API без нового source tracing.

Додатково перевірено 2026-10-14 на `55ed4a4` і на live production:

- `index.html:10` тягне Google Fonts Open Sans 300/400/600/700/800, тоді як
  `app/layout.css` оголошує `'Open Sans', Helvetica, sans-serif` і реально
  вживає лише ваги 400/600/700.
- Іконок у репо немає, крім `favicon-64x64.png` (64px). Джерела для 192/512
  не існує.
- `netlify.toml` містить лише build/publish/NODE_VERSION; секції `[[headers]]`
  немає. Production віддає `bundle.js` з
  `Cache-Control: public,max-age=0,must-revalidate` — дефолт Netlify.
- `gulpfile.js` копіює у dist 24 shader файли, яких production не фетчить.
- Dev server у `gulpfile.js` не має content type для `.webmanifest`, `.png`
  та `.svg`; manifest поїхав би як `application/octet-stream`.
- Жоден probe у `debug/` не використовує persistent browser profile.
- `cdn.storytilecraft.cc` і r2.dev fallback віддають
  `Access-Control-Allow-Origin: https://fluid.storytilecraft.space`, а не `*`:
  demo payload читабельний лише з allowlisted origin.

## 3. Offline contract

### 3.1 Обов'язкова функціональність першого релізу

Після статусу «Готово до роботи offline» без мережі доступні:

- cold start: закрити застосунок і відкрити знову;
- малювання, палітри, Undo/Redo в межах поточної сесії;
- resize, Bake, PNG export;
- імпорт локального PNG/story file та playback імпортованої story;
- усі необхідні UI assets, fonts та shader sources.

Offline restart не означає автоматичне відновлення попереднього малюнка.
Це обмеження показати користувачу до reload/update, не ховати у документації.
Перший запуск без попереднього успішного online install не гарантується.
Якщо кеш видалено браузером, offline доступність більше не гарантується.

### 3.2 Installability та shell

Manifest: стабільний `id`, same-origin `start_url`, явний `scope`, standalone
`display`, name/short_name, theme/background colors; icons 192/512, maskable,
Apple touch icon. `start_url` не має прихованих debug/embedded параметрів.
Наявний `favicon-64x64.png` джерелом не є: апскейл 64px до 512 неприйнятний.
Потрібен vector або >=512px icon master, із якого генеруються всі розміри;
створення master — окрема задача фази A, не побічний ефект build.
Реєстрація SW тільки у bundled production mode; source/dev не захоплювати.
Dev opt-in можливий лише окремим явним режимом для probe.

Font-рішення зафіксоване: self-host Open Sans локальними woff2 підмножинами
вагів 400/600/700 — лише ці ваги вживає `app/layout.css`, а ліцензія Open Sans
(SIL OFL 1.1 / Apache-2.0) hosting дозволяє. Метрики лишаються ті самі, тому
layout не змінюється; системний stack лишається fallback у `font-family`, а не
заміною. Ваги 300 і 800 із поточного Google Fonts запиту не підключати.
`@font-face` з локальними шляхами і `font-display: swap`; у built output нема
жодного посилання на fonts.googleapis.com чи fonts.gstatic.com.
Shell не повинен потребувати Google Fonts/CDN для працездатності.

«Готово до роботи offline» — лише після завершеного precache, active worker
та підтвердження його version/readiness; registration success недостатньо.
Перший uncontrolled page до набуття controller не має показувати готовність.
Install UX має graceful fallback там, де install prompt API відсутній;
на iOS — інструкція Add to Home Screen, не фальшива автоматична установка.

### 3.3 Fetch routing

- Same-origin application navigation до `/` та `/index.html`: version-pinned
  shell із кешу активного release; query параметри передати застосунку незмінно.
- Інші same-origin navigation шляхи (наприклад `/examples/...`): network-only,
  без HTML fallback і без кешування; offline вони просто недоступні.
- Hash-named application assets: cache-first лише для inventory цього release.
- Не застосовувати stale-while-revalidate до app HTML/JS/CSS.
- Не повертати HTML fallback замість JS/CSS/JSON, невідомих assets або SW.
- Не кешувати POST, приватні/auth responses, довільні cross-origin URL.
- `/sw.js` і release metadata не обслуговувати старим app cache.
- Не перехоплювати сторонній origin/editor. Same-origin embedded mode перевірити
  окремо: SW не змінює URL/origin checks чи повідомлення bridge.

## 4. Build identity й atomic installation

Build генерує hash-named JS/CSS/font/icon assets, release metadata та precache
inventory. HTML посилається лише на assets того самого release.

Shader дерева, які `gulpfile.js` копіює у dist (`fluid-engine/shaders/**`,
`app/shaders/**`), у inventory НЕ входять: production читає GLSL registry з
bundle, а source/dev mode offline не підтримується. Вони лишаються звичайними
network-only файлами за правилами §3.3.

Immutable headers застосовуються лише до hashed шляхів нової схеми. Фіксовані
імена поточної схеми (`bundle.js`, `app/layout.css`) `max-age=31536000` не
отримують: інакше відкат схеми залипає в CDN на рік.

`releaseId` — digest канонічного inventory (paths + SHA-256 content hashes).
Git SHA і build time — діагностичні поля, не єдине джерело identity.
SW має стабільний URL `/sw.js`; generated content містить releaseId.
Сам SW та файл metadata, що містить releaseId, не входять у self-referential
hash computation; правило canonical ordering/encoding фіксується в build test.

Нова версія завантажує assets у власний staging cache, перевіряє статус,
тип/формат відповіді та hash кожного required asset. CacheStorage не транзакційна:
логічна atomicity забезпечується завершенням install тільки після всіх перевірок.
Partial cache не використовувати для serving; cleanup failed attempts обмежити
власним cache namespace, не видаляти чужі caches origin.

Missing/404/HTML-as-JS/hash mismatch/quota/network failure відхиляє install.
Активна стара версія лишається працездатною. «Оновлення готове» не показувати.
Successful install переводить worker у waiting; не активувати примусово.

Hash-named assets роблять mixed deployment detectable. Netlify deployment має
публікувати єдиний перевірений dist без повторного іншого remote build.
Precache нової версії не має залежати від assets, які відсутні на поточному deploy.

### 4.1 Retention

Інваріант — liveness, не кількість: не видаляти assets/cache release, поки
існують клієнти, що можуть ними користуватися. Client lease сам по собі не
доказ відсутності — suspended tab може не відповідати, тому при невизначеності
не чистити. Cleanup дозволено лише за доведеної відсутності клієнтів release
і лише у власному cache namespace.

Кількість — лише cap: одночасно зберігати не більше трьох complete releases
(активний, попередній і той, що встановлюється). Cap не скасовує liveness.
Сценарій, який цього вимагає: вкладка на V1 лишається відкритою, виходить V2,
потім V3 — правило «активний плюс попередній» видалило б V1 під живим клієнтом.

Поведінка на cap визначена так: якщо всі збережені releases потрібні живим
клієнтам, новий install відхиляється як quota refusal, активна версія лишається
працездатною, «Оновлення готове» не показується, а UI чесно каже, що оновлення
неможливе, поки відкриті старі вкладки, і перелічує дії (закрити їх або
оновити цю). Автоматично видаляти release, на якому ще може жити клієнт,
заборонено навіть під cap.
User data та downloaded demos не залежать від app release cache cleanup.
Quota refusal безпечніше за автоматичне видалення ще потрібного release.

## 5. New version detection

Реєструвати стабільний SW з `updateViaCache: 'none'`.
Обробляти `updatefound`, worker `statechange`, existing `registration.waiting`,
`controllerchange`, failed/redundant install. Дізнаватися active/waiting release
через явний message protocol із request ID та обмеженим timeout.

Запускати `registration.update()` при запуску, foreground return, online event,
ручній команді та кожні 15 хвилин видимого active застосунку. Automatic checks
throttle до одного разу на хвилину; concurrent calls coalesce.
15-хвилинний таймер скидається після кожної фактичної перевірки, включно з
foreground return і ручною, щоб дві перевірки не йшли підряд; поки документ
приховано, таймер не тікає. Offline failure
не є доказом, що нової версії немає. `navigator.onLine` — лише сигнал для спроби.

Netlify response headers:

- `/sw.js`, release metadata: `Cache-Control: no-store`;
- application HTML: `Cache-Control: no-cache`;
- content-hashed assets: `Cache-Control: public, max-age=31536000, immutable`
  — лише для hashed шляхів нової схеми (§4), не для фіксованих імен.

Перевіряти фактичні HTTP headers CDN, не тільки config text: поточний дефолт
Netlify для `bundle.js` — `public,max-age=0,must-revalidate`, тобто жодне з
цих правил зараз не діє і секцію `[[headers]]` треба створити з нуля.
Жодної обіцянки background detection, коли app/browser закритий або suspended.
Rollback release також є відмінною content identity, не «меншим номером,
який треба ігнорувати».

UI стани: offline unavailable / preparing / offline ready;
update checking / downloading / ready / failed / applying.
Показувати active version, waiting version, результат останньої перевірки.
Download progress не вигадувати: без byte instrumentation лише indeterminate.

## 6. Безпечний update та захист роботи

Дії: «Перевірити оновлення», «Оновити», «Пізніше».
Ні автоматичного reload, ні unconditional `skipWaiting()`/`clients.claim()`.

До explicit activation завершити мазок; не переривати import/export/Bake чи
story playback. Надійно визначати active work/dirty state через production
API; якщо dirty detection неповний — вважати стан потенційно незбереженим.

PNG export — flattened artwork, не checkpoint wet simulation чи Undo.
Користувач може завантажити PNG і потім підтвердити reload; export API completion
не доводить, що файл фізично збережено, тому підтвердження користувача окреме.
Альтернатива — явне «Оновити без збереження» з описом втрати wet state/history.
Відмова чи export error не активують worker.

Multi-tab policy першого релізу: `clients.matchAll` (включно з uncontrolled
same-scope clients) і BroadcastChannel дають UX notification — «відкрито ще N
вкладок» — а не lock. Unknown/unresponsive clients activation НЕ блокують:
suspended tab за визначенням може не відповісти, тому hard-block дав би
оновлення, заблоковане назавжди без виходу для користувача. Блокувати
підтвердження дозволено лише станом самої цієї сторінки (dirty/active work).

Безпеку дає не блокування, а те, що activation не робить примусовий reload:
старий release зберігається (§4.1), новий worker обслуговує старі hash asset
requests, і кожна сторінка reload виконує лише після свого підтвердження.
Тому «закрийте інші вкладки» — рекомендація, і поряд із нею завжди присутня
явна дія «Оновити все одно», яка активує waiting worker, не торкаючись інших
вкладок. Перевірка клієнтів має race з відкриттям нової вкладки; цей race
нешкідливий саме тому, що старі assets лишаються доступними.

Після allow message — `skipWaiting`; після `controllerchange` лише сторінка,
яка явно очікує update, робить один reload. Дедуплікація events і one-shot
reload marker виключають loop. Marker живе у `sessionStorage` цієї вкладки, а
НЕ у `localStorage`: глобальний marker або з'їв би reload сусідньої вкладки,
або заблокував би її власний. Reload перевіряє отриманий releaseId.
Якщо браузер природно активував waiting worker після закриття всіх clients,
наступний cold start відразу відкриває новий shell без update prompt.

Не заявляти automatic recovery після поганого runtime релізу: попередній кеш
не є готовим rollback protocol. Операційний rollback — перевірений redeploy
попереднього artifact; subsequent SW update проходить той самий install gate.

## 7. Offline demos — окремий scope C

UI: «Зберегти offline», downloaded list, availability/size, delete.
Зберігати тільки validated index/story; reuse чинних size/slug/schema checks.
Не кешувати opaque cross-origin responses як нібито verified JSON.
Verified JSON вимагає читабельного CORS response, а обидва demo origins
віддають `Access-Control-Allow-Origin` з конкретним production origin, не `*`
(перевірено 2026-10-14). Отже scope C працездатний лише з origin, який є в
allowlist CDN. Будь-який новий origin (preview deploy, LAN probe) спершу
додається в allowlist; без цього C на ньому не тестується і позначається
NOT TESTED, а не fail реалізації.

Для першої реалізації downloaded records у IndexedDB мають власний schemaVersion,
source URL/slug, fetchedAt, content hash та validated payload. Збереження однієї
story атомарне в IDB transaction; index і records узгоджено читаються offline.
Модель online catalog і downloaded list розділена: remote removal не видаляє
downloaded story мовчки. Зміни incompatibility не мігрувати без schema contract.

Storage estimate/persist, quota errors, cancel, interrupted download та явний
cleanup UI. Persistent storage request може бути відхилений; показати це чесно.
Без download незнайома demo offline недоступна, але painting не блокується.

## 8. Декомпозиція та acceptance

### A. Offline shell

Manifest/icons/fonts, inventory/build identity, SW install/fetch, readiness UI.
Фаза A включає три задачі, які інакше протікають у B: (1) icon master (vector
або >=512px) і генерація розмірів із нього; (2) self-hosted Open Sans woff2
400/600/700 плюс зняття Google Fonts посилання з `index.html`; (3) PWA-придатний
QA serving — content types для `.webmanifest`/`.png`/`.svg` у dev server і
browser harness із persistent profile (§9).
Acceptance: online install → offline → close/reopen → draw/resize/Bake/export,
local PNG/story import/playback. Zero required external network dependencies.
Порожній профіль offline не оголошує себе готовим; storage wipe пояснюється.

### B. Updates

Version metadata, headers, checking/waiting UI, safe activation, multi-tab guards.
Acceptance: V1/V2 на одному origin у production-like serving; V1 лишається при
«Пізніше», V2 повністю готова до «Оновити», old/new assets не змішуються.
Перевірка dirty canvas/export/refusal, waiting at startup і browser natural
activation. Rollback artifact detection також проходить.

### C. Offline demos

Validated download/IDB/list/quota/delete. Acceptance: збережена story працює
після cold start без мережі; незбережена відхиляється явно, shell працює.

### D. Release QA

Preview deploy для V1/V2 update matrix; реальні Android Chrome та iOS Safari /
Add to Home Screen. Фізичний mobile QA вимагає https secure context: SW не
реєструється на `http://LAN-IP`, тому матриця йде через preview URL, не через
локальний сервер. Preview origin не входить у CORS allowlist демо-CDN, тому на
preview повна лише update matrix (B); demo download (C) там або після додавання
origin в allowlist, або позначається production-only і виконується окремим
дозволеним кроком. Production deploy лише за окремим дозволом власника,
після required gate та readback exact production assets/headers.
Review URL й QA instructions доставляються до human acceptance/closing commit.

## 9. Обов'язковий test matrix

Guard: deterministic release hashing, manifest completeness, valid asset paths,
source/dev registration exclusion, routing allowlist, partial-install refusal,
headers definitions, update state machine та once-only activation/reload.
Також машинно перевіряти: у built output (HTML, CSS, manifest) немає жодного
cross-origin посилання — це перевірка обіцянки «zero external dependencies», а
не ручний огляд; inventory не містить shader дерев; immutable rule не матчить
фіксовані імена; retention cap не видаляє release із живим клієнтом.

Browser probe: два реальних builds на одному origin, actual SW/CacheStorage,
не mock fetch-only proof; persisted profile/context між runs. Справжні PNG,
network trace, active/waiting IDs і runner cleanup зберігати поза repo.

Негативні та regression cases:

1. Network cut mid-install; старий complete release працює.
2. Required asset 404, wrong MIME/HTML, hash mismatch, quota exceeded.
3. Offline cold start після повного закриття сторінок, не лише live offline toggle.
4. Дві вкладки, dirty canvas, active stroke/playback/export та suspended client.
5. New tab під час activation; existing old page не reload без згоди.
6. Existing waiting worker до UI bootstrap; failed worker; повторні events.
7. Storage eviction, persist refusal, interrupted demo transaction (для C).
8. Query URLs, source mode, embedded origin security contract.
9. V1 → V2 → rollback V1; ні mixed assets, ні endless reload.
10. WebGL1/2 draw/resize/Save; palette/history/Bake/story regressions незмінні.
11. iOS/Android standalone cold launch, offline launch, return foreground/update.
12. Live CDN headers та побайтний artifact readback після кожного deploy.
13. Типографіка після зняття Google Fonts: панель, слайдери та story controls
    на мобільній ширині не з'їжджають; ваги 400/600/700 приходять із локальних
    файлів, а не з fallback stack.
14. Три живі releases одночасно: cap не видаляє release із живим клієнтом,
    install відхиляється як quota refusal, активна версія лишається робочою.
15. Unresponsive/suspended вкладка: «Оновити все одно» активує waiting worker,
    стара вкладка не reload і не ламається на старих hash assets.

Не складати SwiftShader/browser/physical acceptance в одне вигадане число.
Physical matrix без пристрою позначати NOT TESTED, не PASS.

## 10. Очікувані місця змін

`gulpfile.js` (build identity, hashed assets, static copy і contentTypes dev
server), `index.html` (зняти Google Fonts, додати manifest та apple tags),
`app/layout.css` (`@font-face`), `netlify.toml` (нова секція `[[headers]]`),
`package.json`, `Makefile`; нові app PWA/update controller і build-generated
SW/manifest/version inventory; локальні font та icon assets разом з icon
master; debug unit/browser harness із persistent profile.
Generated dist не комітити.
`docs/SDLC.md` / `DEPLOY.md` — headers, update/release/rollback procedure.

Після spec review створити HANDOFF/QA та зареєструвати тему в AGENTS окремою
командою фазування; зараз registry не містить фіктивного HANDOFF.
Конкретні назви нових runtime files визначити у фазовому плані.

## 11. Джерела lifecycle contract

- https://web.dev/articles/service-worker-lifecycle
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting

Service worker install failure зберігає поточний worker; successful update
waiting та explicit activation — основа контракту. Platform limitations
перевіряються physical QA, не компенсуються необґрунтованими гарантіями.

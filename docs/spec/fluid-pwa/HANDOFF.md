# Handoff: Fluid PWA — offline shell та надійні оновлення

Стан на 2026-10-14. Тема `fluid-pwa` нова: коду ще немає, фазування складено
зі [спеки](./PWA-OFFLINE-UPDATE-SPEC.md) (ревізія 2) командою
`spec-to-handoff`. Baseline `55ed4a4`. Production origin
`https://fluid.storytilecraft.space`.

| Що | Де | Репозиторій |
| --- | --- | --- |
| Спека | `docs/spec/fluid-pwa/PWA-OFFLINE-UPDATE-SPEC.md` | Fluid Paint |
| Цей handoff і майбутній QA | `docs/spec/fluid-pwa/` | Fluid Paint |
| Build, HTML, стилі | `gulpfile.js`, `index.html`, `app/layout.css`, `package.json`, `Makefile` | Fluid Paint |
| Hosting і headers | `netlify.toml` | Fluid Paint → Netlify |
| Новий PWA/update код | `app/` (controller), build-generated SW/manifest/inventory | Fluid Paint |
| Тести й браузерні проби | `debug/` | Fluid Paint |
| Demo catalog (scope C) | `app/story-demo-catalog.js`, bucket `stories` `/fluid-demo/` | Fluid Paint + зовнішній R2/CDN |
| Процедури релізу | `docs/SDLC.md`, `DEPLOY.md` | Fluid Paint |

`INVARIANTS.md` у цьому репозиторії немає; guard кожної фази — конкретні
скрипти `package.json`, як у темі `fluid-2`. Engine physics, палітри та
vendored Tilecraft transport/model/bridge ця тема не чіпає.

Два рішення щодо порядку, ухвалені власником 2026-10-14 при фазуванні:
harness для service worker — окрема spike-фаза **перед** SW (фаза 3), а
hashed assets і release identity йдуть **до** SW (фаза 2), щоб перший же SW
мав чесну identity й atomic install і не переписувався потім.

> **Далі:** фаза 1 — локальні assets і нуль зовнішніх залежностей.

## Що зроблено і працює

Коду теми ще немає. Наявний стан, на який фази спираються (перевірено
2026-10-14 на `55ed4a4`):

| Файл | Стан |
| --- | --- |
| `gulpfile.js` | Збирає `dist/index.html`, `dist/bundle.js`, `dist/app/layout.css`; копіює 24 shader файли та `LICENSE`/`favicon-64x64.png`. Імена фіксовані, hashing відсутній. Dev server без content type для `.webmanifest`/`.png`/`.svg`. |
| `index.html` | Рядок 10 тягне Google Fonts Open Sans 300/400/600/700/800; є лише `favicon-64x64.png`, немає manifest і apple tags. |
| `app/layout.css` | `font-family: 'Open Sans', Helvetica, sans-serif`; реально вживані ваги 400/600/700. |
| `netlify.toml` | Лише build/publish/NODE_VERSION. Секції `[[headers]]` немає; production віддає `bundle.js` з `Cache-Control: public,max-age=0,must-revalidate`. |
| `app/story-demo-catalog.js` | Валідований index/story з CDN і r2.dev fallback. Обидва origin віддають `Access-Control-Allow-Origin` з конкретним production origin, не `*`. |
| `debug/` | Жоден probe не використовує persistent browser profile; SW/CacheStorage ніде не тестується. |
| production bundle | Містить GLSL registry, shader XHR = 0. |

## Головні виміряні факти

Порожньо: тема ще не має жодної реалізованої фази. Факти з'являються тут у
міру закриття фаз, як у решті тем репозиторію.

## НЕЗАКРИТЕ — почни звідси

1. **Фаза 1 — локальні assets і нуль зовнішніх залежностей.**
   Контракт: self-hosted Open Sans woff2 400/600/700 з `@font-face` у
   `app/layout.css`, Google Fonts посилання зняте з `index.html`; icon master
   (vector або ≥512px) і згенеровані з нього 192/512 maskable та apple touch;
   `manifest.webmanifest` зі стабільним `id`, явним `scope`, same-origin
   `start_url` без debug/embedded параметрів; dev server у `gulpfile.js`
   віддає `.webmanifest`/`.png`/`.svg` з правильним content type.
   Service worker у цій фазі ще не з'являється — застосунок лишається
   звичайною сторінкою.
   Guard: новий `node --test` на built output (нуль cross-origin посилань у
   HTML/CSS/manifest, повнота manifest, наявність усіх розмірів іконок,
   ваги 400/600/700 оголошені локально) плюс `npm run build`.
   Probe: відкрити зібраний `dist` у браузері на 320 px і на desktop —
   панель, слайдери та story controls не з'їхали, DevTools Network не має
   жодного запиту до fonts.googleapis.com/fonts.gstatic.com, Application →
   Manifest парситься без помилок і показує іконки.
   Новий інваріант: built output не має зовнішніх network-залежностей.

2. **Фаза 2 — release identity, hashed assets і precache inventory.**
   Контракт: build видає hash-named JS/CSS/font/icon assets, HTML посилається
   лише на assets свого release, `releaseId` = digest канонічного inventory
   (paths + SHA-256), git SHA і build time — діагностичні поля; SW-файл і
   metadata з `releaseId` виключені з self-referential hash; shader дерева в
   inventory не входять. SW ще немає.
   Guard: новий `node --test` на детермінізм hashing (два build — той самий
   `releaseId`), canonical ordering/encoding, відсутність shader шляхів в
   inventory, збіг кожного посилання в HTML з inventory; `npm run build`.
   Probe: зібрати двічі й відкрити `dist` у браузері — малювання, resize,
   Bake, PNG export і локальний імпорт працюють, у Network нема жодного 404
   на hashed шляхах.
   Новий інваріант: усі посилання built HTML належать inventory цього release.

3. **Фаза 3 — QA harness для service worker (spike).**
   Контракт: браузерний harness у `debug/` із persistent Playwright profile
   і production-like serving (правильні content types, `no-store` для
   `/sw.js` і metadata), що вміє: зареєструвати **викидний** SW, закрити всі
   сторінки, запустити профіль знову, прочитати CacheStorage і active/waiting
   стан через message protocol з request ID і timeout, перемкнути offline.
   Справжній SW теми тут не пишеться — фаза доводить саму можливість
   перевірки, щоб фази 4–8 не застрягали на інфраструктурі.
   Guard: harness проходить власний self-test (persistent profile виживає
   перезапуск; victim SW контролює сторінку; offline navigation віддає
   закешований байт), `npm run build` лишається зеленим.
   Probe: запустити harness двічі поспіль на тому самому профілі — другий
   запуск бачить SW і кеш від першого, а не чистий профіль. Артефакти проби
   (trace, скріншоти) лишаються поза repo.
   Межа фази: якщо cold start із повним закриттям сторінок у harness
   недосяжний, це фіксується як обмеження до написання SW, а не під час.

4. **Фаза 4 — SW: install, перевірений precache, fetch routing.**
   Контракт: build-generated `/sw.js` зі стабільним URL і `releaseId`;
   install завантажує inventory у власний staging cache і перевіряє статус,
   тип/формат і hash кожного required asset; будь-який
   404/HTML-as-JS/MIME/hash mismatch/quota/network failure відхиляє install,
   стара версія лишається працездатною, partial cache не обслуговує; fetch
   routing за §3.3 (version-pinned shell для `/` та `/index.html` із
   незмінними query, cache-first лише для inventory цього release, інші
   same-origin шляхи network-only без HTML fallback, жодного SWR для app
   HTML/JS/CSS, `/sw.js` і metadata не з app cache, без POST/auth/довільного
   cross-origin, сторонній origin і embedded bridge не перехоплюються);
   реєстрація лише в bundled production mode.
   Guard: `node --test` на routing allowlist, partial-install refusal,
   source/dev registration exclusion, відмову за кожною причиною зі списку;
   `npm run build`.
   Probe (через harness фази 3): online install → offline → закрити всі
   сторінки → cold start → малювання, resize, Bake, PNG export, локальний
   імпорт PNG/story і playback; потім network cut mid-install і required
   asset 404 — стара версія далі працює.
   Acceptance фази = acceptance §8A спеки.

5. **Фаза 5 — readiness і install UX.**
   Контракт: стани offline unavailable / preparing / offline ready, де
   «Готово до роботи offline» показується лише після завершеного precache,
   active worker і підтвердженої version/readiness — не після registration
   success і не для першого uncontrolled page; чесне повідомлення, що
   offline restart не відновлює попередній малюнок, показане **до**
   reload/update; порожній профіль не оголошує себе готовим; storage wipe
   пояснюється; install prompt має graceful fallback, на iOS — інструкція
   Add to Home Screen без фальшивої автоматичної установки.
   Guard: `node --test` на машину станів readiness (registration success не
   дає ready; uncontrolled page не дає ready; wipe переводить у unavailable).
   Probe: на свіжому профілі пройти шлях від першого відкриття до «Готово до
   роботи offline», потім стерти site data і перезавантажити — застосунок
   чесно повідомляє втрату, а не показує готовність; на iOS-пристрої (або
   мобільному Safari preview) видно інструкцію A2HS, не кнопку установки.

6. **Фаза 6 — headers і detection state machine.**
   Контракт: нова секція `[[headers]]` у `netlify.toml` (`no-store` для
   `/sw.js` і metadata, `no-cache` для app HTML, `immutable` лише для hashed
   шляхів нової схеми); реєстрація з `updateViaCache: 'none'`; обробка
   `updatefound`, `statechange`, наявного `registration.waiting`,
   `controllerchange`, failed/redundant install; message protocol з request
   ID і timeout; перевірки при запуску, foreground return, online event,
   ручній команді та кожні 15 хвилин видимого застосунку з throttle 1/хв,
   coalesce concurrent calls, скиданням таймера після кожної фактичної
   перевірки й зупинкою при прихованому документі; UI показує active
   version, waiting version і результат останньої перевірки; progress
   indeterminate без byte instrumentation; offline failure не тлумачиться
   як «нової версії немає».
   Guard: `node --test` на state machine (включно з existing waiting worker
   до UI bootstrap, failed worker, повторними events), на визначення headers
   і на те, що immutable rule не матчить фіксовані імена; `npm run build`.
   Probe (harness): V1 і V2 на одному origin у production-like serving —
   waiting worker виявлено, «Пізніше» лишає V1 повністю робочою, V2 готова;
   старі й нові assets не змішуються.

7. **Фаза 7 — безпечна активація і захист роботи.**
   Контракт: дії «Перевірити оновлення» / «Оновити» / «Пізніше»; ні
   автоматичного reload, ні unconditional `skipWaiting()`/`clients.claim()`;
   до activation завершується мазок, не перериваються import/export/Bake й
   story playback; dirty state визначається через production API, а при
   неповному визначенні стан вважається потенційно незбереженим; PNG export
   як збереження з окремим підтвердженням користувача (completion API не
   доказ запису файлу) плюс явне «Оновити без збереження» з описом втрати
   wet state/history; multi-tab як notification, а не lock —
   unresponsive/suspended clients активацію не блокують, завжди доступна
   явна дія «Оновити все одно»; після allow — `skipWaiting`, після
   `controllerchange` один reload лише тією сторінкою, що його очікує,
   з one-shot marker у `sessionStorage` цієї вкладки; reload перевіряє
   отриманий `releaseId`; природна активація браузером після закриття всіх
   clients дає новий shell без prompt.
   Guard: `node --test` на once-only activation/reload, дедуплікацію events,
   область marker (`sessionStorage`, не `localStorage`) і на те, що
   unresponsive client не блокує activation.
   Probe (harness + руками): дві вкладки, у першій dirty canvas і активний
   мазок/playback/export — «Оновити» не губить роботу; друга вкладка не
   reload без згоди; нова вкладка, відкрита під час activation, працює на
   старих hash assets; suspended вкладка не блокує «Оновити все одно»;
   жодного reload loop.

8. **Фаза 8 — retention, quota і rollback identity.**
   Контракт: liveness як інваріант (release із можливим живим клієнтом не
   видаляється), cap у три complete releases, який liveness не скасовує;
   на cap новий install відхиляється як quota refusal з чесним UI, активна
   версія лишається, «Оновлення готове» не показується; cleanup лише у
   власному namespace і лише за доведеної відсутності клієнтів; user data й
   downloaded demos не залежать від release cleanup; rollback release
   трактується як інша content identity, а не «менший номер».
   Guard: `node --test` на cap і liveness (release із живим клієнтом не
   видаляється навіть під cap; quota refusal замість видалення), на
   namespace cleanup і на розпізнавання rollback identity.
   Probe (harness): вкладка на V1 лишається відкритою, виходять V2 і V3 —
   V1 не видалено, install відхилено як quota refusal, активна версія
   робоча; далі V1 як rollback artifact проходить той самий install gate
   без mixed assets і без endless reload.

9. **Фаза 9 — offline demos (scope C).**
   Контракт: UI «Зберегти offline», downloaded list з availability/size і
   delete; зберігаються лише validated index/story з reuse чинних
   size/slug/schema checks; opaque cross-origin не трактується як verified
   JSON; записи в IndexedDB мають власний `schemaVersion`, source URL/slug,
   `fetchedAt`, content hash і validated payload; збереження однієї story
   атомарне в IDB transaction; online catalog і downloaded list розділені —
   remote removal не видаляє downloaded story мовчки; storage
   estimate/persist, quota errors, cancel, interrupted download і явний
   cleanup UI; відмову persistent storage показано чесно; без download
   незнайома demo offline недоступна, але малювання не блокується.
   Guard: `node --test` на IDB schema contract, атомарність перерваної
   транзакції, відмову приймати opaque response, розділення каталогів;
   наявні `npm run test:story-demo` і `npm run build` лишаються зеленими.
   Probe: зберегти story offline, зробити cold start без мережі — вона
   відтворюється; незбережена відхиляється явно й shell працює; перервати
   download посередині — жодного напівзаписаного record; відмова persist
   показана як відмова.
   Межа: обидва demo origin віддають ACAO з конкретним production origin,
   тому на будь-якому іншому origin ця фаза позначається NOT TESTED, поки
   origin не додано в allowlist CDN (див. відкриті питання).

10. **Фаза 10 — release QA (scope D).**
    Контракт: preview deploy і повна update matrix V1 → V2 → rollback V1 на
    ньому; реальні Android Chrome та iOS Safari / Add to Home Screen через
    https preview URL (SW не реєструється на `http://LAN-IP`); live перевірка
    фактичних CDN headers і побайтний readback артефактів після кожного
    deploy; оновлені `docs/SDLC.md` і `DEPLOY.md` (headers,
    update/release/rollback процедура); негативна матриця §9 пройдена або
    явно позначена NOT TESTED там, де пристрою чи origin немає.
    Guard: `make verify` і повний набір guard'ів фаз 1–9 зелені на тому
    самому артефакті, що публікується.
    Probe: на preview URL з пристроїв — standalone cold launch, offline
    launch, повернення у foreground з оновленням; на production (лише після
    окремого дозволу власника) readback exact assets/headers.
    Межа: production deploy цим handoff не авторизований; SwiftShader,
    браузерні й фізичні результати не складаються в одне число, а
    відсутній пристрій позначається NOT TESTED, не PASS.

## Відкриті питання й зовнішні передумови

- **Icon master.** Джерела немає: у репо лише `favicon-64x64.png` (64px),
  апскейл до 512 неприйнятний. Власник надає
  vector/≥512px арт чи фаза 1 малює власний мінімальний знак — рішення
  потрібне до початку фази 1.
- **CORS allowlist демо-CDN.** `cdn.storytilecraft.cc` і r2.dev віддають
  `Access-Control-Allow-Origin: https://fluid.storytilecraft.space`. Чи
  додавати preview-origin Netlify в allowlist (потрібен доступ до
  Cloudflare/R2 конфігу), чи scope C QA лишається production-only — від
  цього залежить обсяг фаз 9 і 10.
- **Зміна схеми імен assets.** Фаза 2 прибирає фіксовані `/bundle.js` і
  `/app/layout.css` з production. У репозиторних документах прямих зовнішніх
  посилань на ці URL немає (embedded host відкриває сторінку, не bundle), але
  власник має підтвердити, що жоден зовнішній споживач не лінкує їх напряму.
- **Дозвіл на production deploy** — окремий крок власника після фази 10;
  спека його цим документом не дає.
- **Фізичні пристрої для фази 10** — потрібні реальні Android Chrome та iOS
  Safari; без них відповідні рядки матриці лишаються NOT TESTED.

```
handoff:start fluid-pwa
```

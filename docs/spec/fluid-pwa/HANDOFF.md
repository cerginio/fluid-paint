# Handoff: Fluid PWA — offline shell та надійні оновлення

Стан на 2026-10-15. Фази 1–7 прийняті власником і закриті; фаза 7 — із обов’язковим UX follow-up 7A. Preview/production deploy не виконано.

> **Архів:** фази 1–7 перенесено в [_archive/HANDOFF-phases-1-7.md](_archive/HANDOFF-phases-1-7.md) (2026-10-15); [парні регресійні QA](_archive/QA-phases-1-7.md).

Поточний контракт: release identity/hashed inventory → atomic verified SW install → pinned-shell readiness → detection → explicit safe activation. Compatibility old SHA assets збережено; cap/cleanup/rollback ще немає. Реалізація й історичні вимірювання: [phase 7 report](./PHASE7-REPORT.md) та архів. No-SW/no-phase7 твердження ранніх фаз — лише історія, не чинні обмеження.

## Чинні передумови 7A та збережений борг

- `getUpdateSafety()` трактує dirty як unknown; stroke/import/export/Bake/playback не перериваються. PNG completion не доводить запис файлу: потрібні окрема перевірка й згода або explicit discard із попередженням про artwork/wet/history loss.
- CLIENTS includeUncontrolled та BroadcastChannel — notification, не lock. ALLOW прив’язаний до same-scope WindowClient/exact complete release; no claim/unconditional skipWaiting. Лише requesting page робить один reload після controllerchange з one-shot sessionStorage marker та pinned shell/release verification.
- Partial/failed install не служить shell; cache readiness потребує actual controller/complete/pinned identity. Fonts/icons/shell локальні. Build identity залежить лише від canonical inventory paths+SHA; подробиці encoding — у [архіві](_archive/HANDOFF-phases-1-7.md).
- Історичні PASS не перетворюють physical/CDN/CORS/full-verify та cleanup-readback limitation на перевірене покриття. Нижчий closing check — історичний запис, сервер/PID зараз не перевіряли.

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

> **Далі: обов’язкова фаза 7A — компактний icon-first PWA UX, перед фазою 8.**
> Фазу 7 прийнято власником через `handoff:next` 2026-10-15 і закрито із
> зауваженням щодо UX; closing commit поверх `5d900c1`. Фази 1–7 прийняті.
> [QA-7A–7M](./QA.md), [PHASE7-REPORT.md](./PHASE7-REPORT.md).
> 7A зараз лише контракт/checklist, НЕ реалізація; чекати окремого `start 7A`.
> Фаза 8 заблокована до реалізації, eval і acceptance 7A та окремого дозволу.
> Preview/production deploy не виконано; фази 8–10 не починались.
> Нижчі no-phase7 твердження попередніх фаз — історія, superseded цією фазою.

Нові інваріанти: counter тримає real encoder до Promise completion; ALLOW ACK
не запускає ранній STATUS до old controller; consented session marker дає лише
один own reload; frozen/uncontrolled clients не hard-lock і old hashes лишаються.
Guards — pwa-activation-test.js / actual worker-test; probe — activation-browser.

NOT TESTED: physical Android/iOS/Safari/A2HS/standalone, native GPU/OS reboot,
real mobile suspension/native install dialog/15-minute wall-clock, browser quota/
eviction/MIME/hash injection, full large-story playback, live Netlify/CDN headers,
CORS/demo downloads, full make verify. Physics/palette/vendor незмінні.
Фази 8–10 не реалізовані. **Наступний крок — окремий дозвіл на 7A, не фазу 8.**

## Closing check фази 7 — 2026-10-15

Прийняття власником — acceptance із збереженим боргом, не нове physical/full QA.
Свіжий closing eval виконано в isolated source clone поза repo, щоб не
перебудовувати `dist`, який обслуговує живий стенд. Build PASS; inventory та
releaseId byte-identical retained V1
`4e6ce90e534c2b1929546a183156178cf28eb3571815375bfcf3d4ddbd996eb2`.
Свіжі guards passed/failed окремо: activation **12/0**, detection **15/0**,
readiness **11/0**, worker **12/0**, release **4/0**, assets **7/0**, harness
**5/0**, shader **25/0**, demo **8/0**, palette **6/0**; control API PASS без
enumeration. 12 closing commands exit 0 (build + 10 suites + control), не сума tests.
Evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-closure-01eEQx/result.json`.

Browser probes не перезапускались: повторно прочитано historical final result,
22 exit codes/log paths і 7 probe results PASS; activation **14/0**, detection
**7/0**, readiness **13/0**, production **10/0**, assets **2 viewport**, release
**2 WebGL**, fixture **8 cases** — історичні. Production sources SHA-exact до
frozen evidence (V2 fixture label повернуто до V1 лише для порівняння).
Cleanup verifier FAIL/EACCES стороннього 51333 з parent-readback лишається
обмеженням; жодного нового global free-port claim чи зупинки чужого процесу.

**Живий built stand збережено за прямою вимогою власника:**
`http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`.
Fresh listener readback: actual `node.exe` PID **31212**, parent **70768**,
command `node_modules/gulp/bin/gulp.js startServer` (wrapper PID 17540 не owner).
Fresh HTTP readback: усі **19 inventory entries** HTTP200/SHA-exact і `/sw.js`
HTTP200/exact local SHA. Це single V1 review stand, не live V1/V2 upgrade/CDN proof.
Під час closure сервер не зупиняли, served dist не переписували. Попередня parent
спроба rebuild впала через missing font; clean retry PASS, не «без невдалих спроб».
Deploy відсутній; усі NOT TESTED межі збережено. 7A зараз лише контракт, не UX code.

## Що зроблено і працює

Прийнята реалізація фази 1 (closing commit):

| Файл | Стан |
| --- | --- |
| `index.html` | Google Fonts знято; manifest, theme-color, apple touch; favicon sizes виправлено на 64. Footer attribution лишився текстом без зовнішніх anchors. |
| `app/layout.css` | 9 self-hosted normal Open Sans faces: Latin/Latin-ext/Cyrillic × 400/600/700; swap, чинний fallback stack. Layout rules не змінено. |
| `assets/fonts/open-sans/` | 9 справжніх WOFF2, verbatim SIL OFL 1.1 LICENSE та upstream metadata. |
| `assets/icons/`, `debug/generate-pwa-icons.py` | Retained 733px master, 192/512 any і maskable, 180 apple touch; opaque background і safe circle; відтворюваний Pillow recipe. |
| `assets/PROVENANCE.md` | Owner-directed icon source/hash, pinned Fontsource 5.3.0 archive/integrity, attribution, recipe. |
| `manifest.webmanifest` | Fluid Paint, stable id `/`, explicit scope `/`, clean start_url `/`, standalone, colors, explicit any/maskable entries; без Android related apps. |
| `gulpfile.js` | Binary-safe static copy зі збереженням paths; static watcher; MIME webmanifest/png/svg/woff2; `startServer` task для точного prebuilt dist. |
| `debug/pwa-assets-test.js`, `package.json` | `npm run test:pwa-assets`: built-output guard. |
| `debug/pwa-assets-browser-test.js`, `package.json` | `npm run test:pwa-assets:browser`: real Chromium + production dist + gulp MIME; унікальні external evidence, cleanup і port bind proof. |
| `docs/spec/fluid-pwa/QA.md` | Виконувані українські кроки review, 8 сценаріїв, факти й чесні межі. |

Історичний стан до реалізації (перевірено 2026-10-14 на `55ed4a4`;
нижня таблиця — baseline, не поточний стан):

| Файл | Стан |
| --- | --- |
| `gulpfile.js` | Збирає `dist/index.html`, `dist/bundle.js`, `dist/app/layout.css`; копіює 24 shader файли та `LICENSE`/`favicon-64x64.png`. Імена фіксовані, hashing відсутній. Dev server без content type для `.webmanifest`/`.png`/`.svg`. |
| `index.html` | Рядок 10 тягне Google Fonts Open Sans 300/400/600/700/800; є лише `favicon-64x64.png`, немає manifest і apple tags. |
| `app/layout.css` | `font-family: 'Open Sans', Helvetica, sans-serif`; реально вживані ваги 400/600/700. |
| `netlify.toml` | Лише build/publish/NODE_VERSION. Секції `[[headers]]` немає; production віддає `bundle.js` з `Cache-Control: public,max-age=0,must-revalidate`. |
| `app/story-demo-catalog.js` | Валідований index/story з CDN і r2.dev fallback. Обидва origin віддають `Access-Control-Allow-Origin` з конкретним production origin, не `*`. |
| `debug/` | Жоден probe не використовує persistent browser profile; SW/CacheStorage ніде не тестується. |
| production bundle | Містить GLSL registry, shader XHR = 0. |


**Новий інваріант фази 1:** built HTML/CSS/manifest не має зовнішніх network
references; fonts/icons/shell self-hosted. Guard — `debug/pwa-assets-test.js`.
Це не заборона optional runtime Demo data: відкриття + дало 2 запити до CDN
index; demo/CORS/playback не є acceptance фази 1. SW/offline/install/update,
фізичні Android/iOS та production headers/deploy — NOT TESTED / майбутні фази.
Ширина 320px — Chromium viewport, не фізичний телефон. Mobile extension
накладається на основну панель за чинним layout; opacity/UX не змінено.
Жодного engine/palette/vendored коду не змінено. Власник прийняв фазу 1
командою `handoff:next`; перелічені NOT TESTED межі збережені.
Closing check 2026-10-14: `npm run build` PASS, `npm run test:pwa-assets`
7 passed / 0 failed. Browser evidence вище збережено без повторного запуску.

## НЕЗАКРИТЕ — почни звідси


7A. **Обов’язкова фаза 7A — компактний icon-first PWA UX перед фазою 8.**
   **Лише специфікація/checklist; НЕ реалізовано.** Вимога власника при
   `handoff:next`: «переробити UX на компактним без тексту з іконками і мінімум
   тексту, текст англійською по замовченню, якщо нема локалізації то і не треба».
   Починати тільки після окремого `start 7A`; closure 7 не дозволяє UX implementation.
   - [ ] Замість великої текстової PWA панелі — компактні icon-first status/actions;
     у звичайному/collapsed стані мінімум тексту, без довгих пояснень або IDs.
   - [ ] Коротка English copy за замовчуванням для PWA status, actions, errors,
     install fallback і consent. Повторно використати локалізацію **лише якщо вона
     вже існує**; якщо її немає — English-only, без нового framework/catalogs або
     окремої localization requirement. Наявність локалізації перевірити на старті,
     цей closure не стверджує результату такої перевірки.
   - [ ] Release/shell IDs, timestamps і технічні деталі — secondary disclosure,
     не домінантний main UI; debugging/pinned identity checks не прибирати.
   - [ ] Icon-only controls мають короткі English tooltips/accessible names,
     keyboard activation, visible focus і зрозумілі status/error announcements.
     Не покладатися лише на колір; pointer/touch controls не перекривають canvas
     або основні File/Player/State controls на desktop і 320px.
   - [ ] Мінімум тексту НЕ скасовує loss-consent: concise English попередження
     перед reload/update про artwork/wet paint/Undo loss, PNG flattened/not backup,
     окремі export → file verification → confirmation та explicit discard/cancel.
     Unknown dirty, busy gates, once-only own reload, no claim, multi-tab notification
     not lock, embedded exclusion і genuine install policy лишаються незмінними.
   - [ ] Guard: production activation/detection/readiness/worker suites та build;
     адаптувати copy/selectors assertions до нового контракту, не послаблюючи gates.
     Probe: real desktop/320px icon actions, keyboard/accessibility, collapsed/
     details/consent/error/install states і retained actual V1/V2 activation matrix;
     actual screenshots та loss-consent review до owner acceptance.
   - [ ] Оновити QA-7A historical snapshot labels як історію, додати окремі
     runnable QA-7AUX scenarios без колізії з існуючим **QA-7A** (це сценарій
     фази 7, не acceptance фази 7A). Record fresh evidence, потім owner review.
   **Gate:** фазу 8 не починати до implementation + eval + owner acceptance 7A
   і окремого дозволу на 8. Physical/CDN/CORS/full-verify борг не зникає від UX.

8. **Фаза 8 — retention, quota і rollback identity.**
   **Передумова: 7A реалізована, перевірена та прийнята; окремий дозвіл на фазу 8.**
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

- **Icon master — рішення закрите власником 2026-10-14.** Вказано існуючі
  assets у `D:/work/js-games/ua-dream/tilecraft/images/icons/` і manifest у
  `tilecraft/manifest.webmanifest`. Інспектовано 733/512px арт; master взято
  з `icon-733-maskable.png` (733×733), byte-for-byte retained тут. Не upscale.
  Provenance і recipe — `assets/PROVENANCE.md`. Арт owner-directed, нової
  ліцензії на нього не вигадано; manifest адаптовано до Fluid Paint, без
  StoryTilecraft/Android identity. Це не відкрита передумова фази 1.
- **CORS allowlist демо-CDN.** `cdn.storytilecraft.cc` і r2.dev віддають
  `Access-Control-Allow-Origin: https://fluid.storytilecraft.space`. Чи
  додавати preview-origin Netlify в allowlist (потрібен доступ до
  Cloudflare/R2 конфігу), чи scope C QA лишається production-only — від
  цього залежить обсяг фаз 9 і 10.
- **Зміна схеми імен assets.** Фаза 2 прибирає фіксовані `/bundle.js` і
  `/app/layout.css` з production. У репозиторних документах прямих зовнішніх
  посилань на ці URL немає (embedded host відкриває сторінку, не bundle), але
  власник дозволив міграцію «Починай фазу 2» після повідомлення про ці URL.
  Це не незалежний зовнішній consumer audit; deploy все ще окремо заборонений.
- **Дозвіл на production deploy** — окремий крок власника після фази 10;
  спека його цим документом не дає.
- **Фізичні пристрої для фази 10** — потрібні реальні Android Chrome та iOS
  Safari; без них відповідні рядки матриці лишаються NOT TESTED.

```
handoff:start fluid-pwa
```

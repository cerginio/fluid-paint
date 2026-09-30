# Handoff: Fluid Paint — публічні демо з R2

Стан на 2026-09-30, гілка `feat/brush_shapes`. Фази 1–3 зі
[спеки](../../FLUID-R2-DEMO-SPEC.md) та фаза 4 за
[BUG-REPORT.md](../fluid-player-ux-fix/BUG-REPORT.md) завершені; власник
прийняв фазу 4 командою `handoff:next`.
Код фази 4: `ua-dream` `0266a0bf`, Fluid Paint `4dd7dee`;
vendored `message-api.js` `aa51aff`, manifest `ua-dream` `67be1aca`.

| Що | Де | Репозиторій |
| --- | --- | --- |
| Спека | `docs/FLUID-R2-DEMO-SPEC.md` | Fluid Paint |
| Розслідування мапінгу Fluid Play | `docs/spec/fluid-player-ux-fix/BUG-REPORT.md` | Fluid Paint; причини також у `ua-dream` |
| QA-фікстура мапінгу | `docs/spec/fluid-player-ux-fix/triangle-parity.json` | Fluid Paint |
| Експорт форми й браузерна проба | `tilecraft/lib/fluid-model.js`, `tilecraft/tests/fluid-player-model-probe.html` | `ua-dream` |
| Цей handoff і майбутній QA | `docs/spec/fluid-demo-r2/` | Fluid Paint |
| Demo UI, catalog client, Player, preset API | `index.html`, `app/`, `debug/`, `gulpfile.js` | Fluid Paint |
| Канонічні fixture й генератор index | `tilecraft/viewer/engines/three/fixtures/catalog/`, `tilecraft/scripts/story-catalog-index.mjs` | `ua-dream` |
| Публічні об'єкти й CORS | bucket `stories`, `/fluid-demo/` | зовнішній R2/CDN |

Vendored `message-api.js`, `fluid-model.js` і `fluid-gamifier-bridge.js` мають
канонічні копії в `ua-dream` і копії тут. Фаза 4 змінила обидві копії
`fluid-model.js`. Паралельна зміна `message-api.js` на боці `ua-dream`
додала необов'язковий `sessionId`; його vendored копію звірено за SHA-256,
але канонічна зміна належить іншій незавершеній роботі і не входить у коміт
фази 4 на тому боці. Процедура —
`ua-dream/docs/spec/fluid-paint/fluid-paint-vendor-manifest.md`.

> **Далі:** відкриті операційні пункти нижче; нової фази коду в цьому handoff
> не заплановано.

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `app/story-file-loader.js` | Локальний і R2 JSON проходять спільний `parse()` / `summarize()`; межі 25 MiB і 500 000 тайлів; bounds рахуються без spread для великих моделей. |
| `app/story-demo-catalog.js` | Валідатор index, фіксовані CDN і тимчасова `r2.dev` база, перевірений slug, обмежене потокове читання index (128 KiB) і моделі (25 MiB). Резерв вмикається лише після мережевої відмови `fetch`, не після HTTP/JSON/abort. |
| `debug/story-demo-catalog-test.js`, `debug/story-demo-fixture-probe.js` | Тести контракту й проба трьох канонічних fixture без другої копії в цьому репозиторії. |
| `debug/story-demo-catalog-probe.html`, `Makefile` | Браузерна проба з контрольованим `fetch`; `make demo-qa-server` запускає локальний `http-server`. |
| `app/ui/story-tools.js`, `app/story-playback-controller.js` | Demo робить Refresh, вибір і Run через спільний preflight та Player. Невдалий fetch/parse не змінює модель чи canvas; активне відтворення не підміняється. Помилка старту до малювання відновлює snapshot і лишає модель для повтору Play. |
| `app/ui/preset-api.js` | `demo-r2` є в `full`; у `features`/`preset` вмикається явно й потребує `player`. `empty` і старі пресети не запитують R2. |
| `index.html`, `app/layout.css`, `app/ui/panel.js`, `gulpfile.js` | Вкладки `Demo | File | Player | State`, статуси й доступний slug у Player; mobile sheet лишається в межах viewport. Option Demo має темний текст на світлому фоні, вкладки не обрізаються при 320 px. CSS-виправлення ще треба викласти на production. |
| `debug/story-demo-ui-probe.html`, `debug/story-demo-ui-test.js` | Локальна контрольована проба трьох назв, помилок index/model і playback; без R2 чи Tilecraft Editor. |
| `tilecraft/lib/fluid-model.js`, `vendor/tilecraft/fluid-model.js` | Кількість вершин не масштабується; `a`, `sa` і видимі форми передаються; полігон із заданим числом сторін поза `3..8` відхиляється. Обидві копії побайтно рівні. |
| `fluid-engine/tilecraft-stroke-player.js`, `app/story-playback-controller.js`, `index.html` | Polygon footprint і кут відтворюються; `mod=2` дає два контакти. Альфа використовує криву ручного пензля; до Play обирається Natural/RYB або Digital/RGB. |
| `debug/tilecraft-spot-gpu-test.js`, `debug/tilecraft-source-model-ui-test.js` | Браузерні проби Tilecraft-експорту, GPU alpha mass/покриття tap і path, завантаження фікстури через UI. |

## Головні виміряні факти

- Guard фази 1: `npm run test:story-demo` — 6/6, `npm run test:story-ui`
  — PASS, `npm run build` — PASS. Browser probe: 2/2 сценарії; власник
  підтвердив QA pass 2026-09-30.
- Guard фази 2: `npm run test:story-demo` — 6/6;
  `npm run test:story-ui`, `npm run test:ui-preset`,
  `npm run test:tilecraft`, `npm run build` — PASS.
  Браузерні `npm run test:story-demo:ui` і
  `npm run test:ui-preset:browser` — PASS; власник підтвердив QA pass
  2026-09-30. Контрольована UI-проба має 3 записи й 8 кадрів у моделі;
  це не live перевірка R2.
- Потокова проба канонічних fixture: 3 моделі, кожна має 8 кадрів і 46 861
  drawable items; фактичні розміри 4 095 097, 4 094 566 і 4 093 329 байтів.
- У канонічному index зі спеки — 3 записи; slug `story-8-frames-hibrid`
  пишеться саме так. Це початкові дані, а не список option у коді.
- Спека фіксує 3 моделі розміром 4 095 097, 4 094 566 і 4 093 329 байтів;
  перед публікацією звірити їх на боці `ua-dream` командою
  `node tilecraft/scripts/story-catalog-index.mjs --check`.
- Перевірка зі спеки на 2026-09-30: `/public-test/index.json` повертав інший
  каталог, `/public-test/story-8-frames-hibrid.json` — 404, а GET з Origin
  Fluid Paint не мав `Access-Control-Allow-Origin`. `/public-test/` не є
  джерелом цього Demo.
- Розслідування Fluid Play 2026-09-30: Tilecraft трактує `polygonSize` як
  число вершин, Fluid Player відтворює `polygon` круглим пензлем; експорт
  губить `tile.a` і `tile.sa` та масштабує `polygonSize`. Імпорт завжди
  обертає hex у RYB; густина replay spot відрізняється від ручного tap.
  Детальні докази й обмеження — у
  [BUG-REPORT.md](../fluid-player-ux-fix/BUG-REPORT.md). Це не частина
  прийнятих фаз 1–2.
- Фаза 3: GET чотирьох `/fluid-demo/` об'єктів із трьома Origin дав 12/12
  відповідей 200 з точним CORS; SHA-256 збігся з канонічними fixture.
  Те саме підтверджено для тимчасового `r2.dev` маршруту. Production
  Chromium із примусово відхиленим CDN завантажив index і всі три моделі
  через `r2.dev`: кожна має 8 кадрів, 46 861 drawable items і перейшла у
  `playing`. Це не замінює перевірку в ураженій мережі власника.
- Guard фази 3: `npm run test:story-demo` — 8/8; `npm run test:story-ui`,
  `npm run test:ui-preset`, `npm run test:tilecraft`, `npm run build` — PASS.
  Browser probe `npm run test:story-demo:ui` — PASS. Коефіцієнт пензля
  змінено з 0.5 на 1 і його тест узгоджено; калібрування форми/густини
  лишається завданням фази 4.
- На боці `ua-dream` тест моделі — 11/11 PASS, але закріплює хибне
  масштабування `polygonSize` (див. BUG-REPORT). Цей стан не стосується
  приймання фази 3.
- Фаза 4, guard: `npx vitest run tilecraft/tests/fluid-model.test.js` на боці
  `ua-dream` — 15/15; тут `npm run test:tilecraft`, `npm run test:timing`,
  `npm run build`, `npm run test:fluid-control`, `npm run test:ui-preset`,
  `npm run test:story-ui` — PASS; `npm run test:color` — 42/42,
  `npm run test:story-demo` — 8/8. Три vendored файли збіглися за SHA-256
  з робочими канонічними копіями на момент перевірки.
- Фаза 4, браузерні probe: `debug/tilecraft-source-model-ui-test.js` — PASS;
  `debug/tilecraft-spot-gpu-test.js` — PASS. За seed 20260930, DPR 1,
  alpha `0.0204` один manual tap і replay spot дали однакові alpha mass
  `1802.20`, площу `23 164` пікселів і трикутну гармоніку `h3=0.254`.
  Один прямий path-перехід дав відношення replay/manual `0.9963` за mass
  і `0.9992` за площею. UI-проба фікстури підтвердила 6 операцій,
  `a=128`, різні кути `sa`/`mod=2` та обидва режими кольору.

## НЕЗАКРИТЕ — почни звідси

~~1. **Фаза 1 — catalog client і preflight (Fluid Paint).**~~ — ЗАКРИТО
   2026-09-30. Guard, браузерна проба й QA пройдені; факти наведено вище,
   сценарії — у [QA.md](./QA.md#фаза-1--catalog-client-і-preflight).

~~2. **Фаза 2 — Demo UI і наявний Player (Fluid Paint).**~~ — ЗАКРИТО
   2026-09-30. Guard, контрольована браузерна проба й QA власника пройдені;
   сценарії — у [QA.md](./QA.md#фаза-2--demo-ui-і-player).

~~3. **Фаза 3 — публікація й live перевірка (контракт `ua-dream`/R2,
   інтеграція Fluid Paint).**~~ — ЗАКРИТО 2026-09-30. Чотири канонічні
   об'єкти опубліковано в `/fluid-demo/` без змін; production і localhost
   Origin мають точний CORS. Через DNS sinkhole в мережі власника CDN
   викликає помилку сертифіката, тому власник погодив тимчасовий мережевий
   fallback на `r2.dev` для того самого шляху. На production всі три slug
   відкрили Player з 8 кадрами при примусовій відмові CDN; guard і браузерна
   проба пройшли. Власник дав `handoff:next`; сценарії та межі перевірки —
   у [QA.md](./QA.md#фаза-3--публічний-r2-і-live-інтеграція).

~~4. **Фаза 4 — виправлення мапінгу Fluid Play (`ua-dream` ↔ Fluid Paint).**~~
   — ЗАКРИТО 2026-09-30 за `handoff:next` власника. Експорт, форма,
   прозорість, режими кольору, guard і контрольовані браузерні проби пройшли;
   виміри наведено вище, сценарії — у [QA.md](./QA.md#фаза-4--мапінг-tilecraft-і-fluid-play).

## Відкриті питання й зовнішні передумови

- Власник має викласти локальне CSS-виправлення Demo select і вкладок та
  перевірити QA-3J–QA-3K на production. Поточний production на момент
  закриття фази ще віддає старий CSS.
- У мережі власника перевірити QA-3H–QA-3I без примусового блокування в
  браузерній пробі. `r2.dev` — тимчасовий development URL; потрібен
  production маршрут або зняття Whalebone блокування CDN. Перший невдалий
  CDN-запит може залишатися в консолі навіть після успішного fallback.
- Валідатор фази 1 приймає ISO 8601 timestamp з часовою зоною для
  `publishedAt` і, якщо є, `generatedAt`, як у канонічному fixture. Спека
  не задає формат явно; перед публікацією підтвердити, чи це остаточний
  контракт каталогу.
- На боці Fluid Paint залишається візуальне порівняння однієї моделі на
  Tilecraft і Fluid Play: контрольований GPU допуск `0.85…1.15` виміряно
  для одного tap і одного path-переходу, але не для утримання 3/10 tick.
  `mod=2` використовує два контакти; густина в зоні їх перетину може
  відрізнятися від одного Canvas fill у Tilecraft.
- На боці `ua-dream` паралельну зміну `tilecraft/lib/message-api.js` з
  `sessionId` слід завершити в її власному циклі й зафіксувати commit pin
  у vendor manifest. Vendored Fluid Paint копія у `aa51aff` збігається з
  поточним канонічним робочим файлом; manifest оновлено в `67be1aca`.

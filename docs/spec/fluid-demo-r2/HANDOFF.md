# Handoff: Fluid Paint — публічні демо з R2

Стан на 2026-09-30, гілка `feat/brush_shapes`. Фази 1–3 зі
[спеки](../../FLUID-R2-DEMO-SPEC.md) завершені й прийняті QA власником.

| Що | Де | Репозиторій |
| --- | --- | --- |
| Спека | `docs/FLUID-R2-DEMO-SPEC.md` | Fluid Paint |
| Розслідування мапінгу Fluid Play | `docs/spec/fluid-player-ux-fix/BUG-REPORT.md` | Fluid Paint; причини також у `ua-dream` |
| Цей handoff і майбутній QA | `docs/spec/fluid-demo-r2/` | Fluid Paint |
| Demo UI, catalog client, Player, preset API | `index.html`, `app/`, `debug/`, `gulpfile.js` | Fluid Paint |
| Канонічні fixture й генератор index | `tilecraft/viewer/engines/three/fixtures/catalog/`, `tilecraft/scripts/story-catalog-index.mjs` | `ua-dream` |
| Публічні об'єкти й CORS | bucket `stories`, `/fluid-demo/` | зовнішній R2/CDN |

Vendored `message-api.js`, `fluid-model.js` і `fluid-gamifier-bridge.js` мають
канонічні копії в `ua-dream` і копії тут. Ця спека їх не змінює. Якщо під час
роботи потреба змінити будь-який із них виникне, обидві копії та процедуру
звірити за `ua-dream/docs/spec/fluid-paint/fluid-paint-vendor-manifest.md`.

> **Далі:** фаза 4 — виправлення мапінгу Fluid Play за [BUG-REPORT.md](../fluid-player-ux-fix/BUG-REPORT.md); перед нею перевірити відкриті операційні пункти нижче.

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

4. **Фаза 4 — виправлення мапінгу Fluid Play (`ua-dream` ↔ Fluid Paint).**
   Після фази 3 виконати [BUG-REPORT.md](../fluid-player-ux-fix/BUG-REPORT.md)
   як **одну наскрізну фазу**. На боці `ua-dream`: зберегти в моделі
   `polygonSize` як цілу кількість вершин без масштабування, передати
   `tile.sa` і `tile.a`, узгодити підтримані форми й контракт vendored
   `fluid-model.js`/bridge. На боці Fluid Paint: відтворити силует і поворот
   polygon spot, врахувати альфу плитки, калібрувати кількість фарби
   окремо для spot і path та дати до запуску вибір Natural/RYB або
   Digital/RGB з відповідним кодуванням імпортного hex. Звірити обидві
   копії vendored файлів за `ua-dream/docs/spec/fluid-paint/fluid-paint-vendor-manifest.md`.
   **Закриття:** однакова fixture з трикутником (`polygonSize:3`),
   `sa≠0`, `a<255` і RGB-кольорами зберігає ці поля в JSON, має
   `brushShape.sides === 3` у плані, дає трикутний контур у Fluid Play;
   Natural і Digital дають перевірений мапінг кольору, а виміряні alpha
   mass/площа покриття replay spot відповідають узгодженому еталону
   ручного tap. Фаза завершується лише коли обидва репозиторії лишаються
   робочими. **Guard:** тести моделі `ua-dream`, `npm run test:tilecraft`,
   `npm run test:color`, `npm run test:timing`, `npm run build` тут;
   окремо перевірити однаковий vendored контракт. **QA probe:** відкрити
   той самий кадр у Tilecraft і Fluid Play на парі локальних стендів,
   запустити replay, порівняти контур, поворот, прозорість і два колірні
   режими; зафіксувати GPU readback для короткого tap і replay spot.
   Перед review додати окремі сценарії в `QA.md`, згруповані за сторонами.

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
- Для фази 4 ще потрібен вимірюваний допуск паритету alpha mass/площі
  покриття на підтриманому WebGL шляху; за скриншотами числовий допуск
  встановити не можна. Окремо перевірити, чи `mod == 2` потребує двох
  проходів для збереження подвійного контуру Tilecraft.

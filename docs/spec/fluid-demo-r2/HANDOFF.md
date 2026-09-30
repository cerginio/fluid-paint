# Handoff: Fluid Paint — публічні демо з R2

Стан на 2026-09-30, гілка `feat/brush_shapes`. Фаза 1 зі
[спеки](../../FLUID-R2-DEMO-SPEC.md) завершена й прийнята QA власником.

| Що | Де | Репозиторій |
| --- | --- | --- |
| Спека | `docs/FLUID-R2-DEMO-SPEC.md` | Fluid Paint |
| Цей handoff і майбутній QA | `docs/spec/fluid-demo-r2/` | Fluid Paint |
| Demo UI, catalog client, Player, preset API | `index.html`, `app/`, `debug/`, `gulpfile.js` | Fluid Paint |
| Канонічні fixture й генератор index | `tilecraft/viewer/engines/three/fixtures/catalog/`, `tilecraft/scripts/story-catalog-index.mjs` | `ua-dream` |
| Публічні об'єкти й CORS | bucket `stories`, `/fluid-demo/` | зовнішній R2/CDN |

Vendored `message-api.js`, `fluid-model.js` і `fluid-gamifier-bridge.js` мають
канонічні копії в `ua-dream` і копії тут. Ця спека їх не змінює. Якщо під час
роботи потреба змінити будь-який із них виникне, обидві копії та процедуру
звірити за `ua-dream/docs/spec/fluid-paint/fluid-paint-vendor-manifest.md`.

> **Далі:** фаза 2 — Demo UI, preset gating та запуск через наявний Player.

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `app/story-file-loader.js` | Локальний і R2 JSON проходять спільний `parse()` / `summarize()`; межі 25 MiB і 500 000 тайлів; bounds рахуються без spread для великих моделей. |
| `app/story-demo-catalog.js` | Валідатор index, фіксована база URL, перевірений slug, обмежене потокове читання index (128 KiB) і моделі (25 MiB). Наразі окремий модуль; підключення до bundle — фаза 2. |
| `debug/story-demo-catalog-test.js`, `debug/story-demo-fixture-probe.js` | Тести контракту й проба трьох канонічних fixture без другої копії в цьому репозиторії. |
| `debug/story-demo-catalog-probe.html`, `Makefile` | Браузерна проба з контрольованим `fetch`; `make demo-qa-server` запускає локальний `http-server`. |
| `app/ui/story-tools.js` | File уже завантажує модель у `StoryPlaybackController` і перемикає на Player. |
| `app/ui/preset-api.js` | Є `mode=full`, `features`, `preset`, `empty`; feature `demo-r2` ще немає. |
| `index.html` | Поточний порядок вкладок: File, Player, State; Demo ще немає. |

## Головні виміряні факти

- Guard фази 1: `npm run test:story-demo` — 6/6, `npm run test:story-ui`
  — PASS, `npm run build` — PASS. Browser probe: 2/2 сценарії; власник
  підтвердив QA pass 2026-09-30.
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

## НЕЗАКРИТЕ — почни звідси

~~1. **Фаза 1 — catalog client і preflight (Fluid Paint).**~~ — ЗАКРИТО
   2026-09-30. Guard, браузерна проба й QA пройдені; факти наведено вище,
   сценарії — у [QA.md](./QA.md#фаза-1--catalog-client-і-preflight).

2. **Фаза 2 — Demo UI і наявний Player (Fluid Paint).** За
   [спекою §4–5](../../FLUID-R2-DEMO-SPEC.md) додати вкладку Demo перед File,
   статуси й доступність, Refresh, вибір, Run, захист від пізніх відповідей,
   блокування підміни активного Player та автозапуск через той самий
   `StoryPlaybackController`. Додати `demo-r2` з залежністю від `player` у
   preset API, адаптивний layout і порядок скриптів. **Закриття:** локальний
   browser probe з контрольованим catalog показує три назви; вибір не
   завантажує модель; Run перемикає на Player і запускає painting; помилка
   Run залишає попередню модель, canvas і Demo. `empty`/`draw-min` та
   features без `demo-r2` не роблять R2-запитів. **Guard:**
   `npm run test:story-ui`, `npm run test:ui-preset`,
   `npm run test:tilecraft`, `npm run build`. **QA probe:** відкрити
   standalone локально, натиснути Demo → Refresh index → Run; побачити
   `Demo | File | Player | State`, потім активний Player, `Painting story…`
   і progress. Перевірити Pause/Resume/Stop/Restore та вузький екран.

3. **Фаза 3 — публікація й live перевірка (контракт `ua-dream`/R2,
   інтеграція Fluid Paint).** Це окремий reviewable крок на стороні
   `ua-dream`/R2: перевірити канонічні fixture, додати точні CORS origins,
   опублікувати три моделі у `/fluid-demo/`, потім index, не змінюючи JSON і
   не перезаписуючи `/public-test/`. Фаза Fluid Paint не редагує код
   `ua-dream` і не записує в R2 за нього; вона приймає опублікований
   контракт і перевіряє standalone застосунок за
   [спекою §6, FD-1–FD-8](../../FLUID-R2-DEMO-SPEC.md). **Закриття:**
   реальний GET index і кожної моделі з Origin production і localhost має
   коректний CORS; TLS домену чинний; на `https://fluid-paint.netlify.app/`
   усі три slug запускають Player без Tilecraft. Помилки мережі й Refresh
   не знищують останній валідний список чи canvas. **Guard:** тести й build
   фази 2. **QA probe:** на production відкрити Demo, побачити 3 назви й
   час успішного Refresh, запустити кожну модель і перевірити 8 кадрів;
   окремо перевірити CORS з `http://localhost:3000`.

## Відкриті питання й зовнішні передумови

- Хто виконує окремий reviewable запис до R2 та зміну CORS на боці
  `ua-dream`/Cloudflare? Без цього фазу 3 не закрити.
- Чи має `cdn.storytilecraft.cc` чинний TLS-сертифікат у мережі власника?
  Якщо ні, до ввімкнення Demo потрібен production custom domain і окрема
  конфігураційна зміна base URL; `r2.dev` не є production fallback.
- Валідатор фази 1 приймає ISO 8601 timestamp з часовою зоною для
  `publishedAt` і, якщо є, `generatedAt`, як у канонічному fixture. Спека
  не задає формат явно; перед публікацією підтвердити, чи це остаточний
  контракт каталогу.

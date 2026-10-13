# Handoff: fluid-2

Стан на 2026-10-13. Гілка під час фазування: `feat/brush_shapes`.
План і defaults закомічені в `a0ea507`. Фаза A прийнята власником і
закрита командою `handoff:next` 2026-10-13; її код і документи входять
у closing commit цієї фази.
Фази B–C не розпочато.
Спека: [PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md](../docs/PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md).
Тема локальна для цього репозиторію; зовнішній Tilecraft та vendored
transport/model/bridge не змінювати.

Після фазування власник перейменував тему на `fluid-2` і окремо замовив
нові стартові defaults застосунку: fluidity `0.7`, bristles count `12`,
brush size `12`. Ці зміни в `paint-setup.js` / `paint.js` не є виконанням
фаз A–C; engine defaults інших хостів лишаються чинними.

> **Далі:** фаза B — наскрізна інтеграція незалежної палітри за §3.2–3.5 і §5 P1 спеки. Рішення щодо HEX/White/Black закриті нижче; B не починати без окремої команди.

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `docs/PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md` | Контракт двох патчів, межі, сумісність і приймання. |
| `paint.js`, `app/ui/color.js`, `app/ui/ryb.js` | Наявне ручне малювання і палітри; глобальний colorModel досі перефарбовує весь матеріал. |
| `app/story-playback-controller.js`, `app/fluid-control-api.js`, `fluid-engine/tilecraft-stroke-player.js` | Чинні entry points кольору; ще не інтегровані зі спільним RGB-полотном. |
| `gulpfile.js`, `common.js`, `fluid-engine/gl/wrappedgl.js` | Чинна збірка копіює шейдери; runtime завантажує їх окремими XHR. |
| `AGENTS.md` | Тему зареєстровано з цим HANDOFF. |

Чинний код тут описано за попереднім розбором, не як результат нового eval.
На момент створення плану в дереві вже була зміна
`.claude/skills/handoff/SKILL.md`; власник явно замовив включити її в коміт.
Перед фазою звірити актуальний Git-стан; не відкидати чужі зміни.

## Підсумок прийнятої фази A — 2026-10-13

- `app/paint-color-adapter.js`: encode RGB, чинні палітри, точний HEX, stroke
  payload із незміненою alpha. Завантажено в source/bundle, але production
  producers його не викликають. `paint.js`, engine та vendored файли не змінено.
- `debug/paint-color-adapter-probe.html` / `.js`: ізольований engine host.
  `npm run test:color-adapter` — 6/6; `npm run test:color` — 42/42;
  shader lint і production build PASS.
- `npm run test:color-adapter:gpu`: WebGL1/2 × float/half-float — 4 PASS;
  68 decode checks у межах 1 byte, 12 контрольних пар по 30 steps,
  frozen/active raw та export delta 0. Source/build smoke PASS зі старим RYB.
- Active fixture задає відомий потік `[2,1]`, fluidity `0.9`: матеріал рухався.
  Без заданого потоку початковий короткий fixture мав нуль post-stroke руху;
  це не evidence зламаної production physics. Метод/допуск і negative control
  задокументовано в QA; physical GPU не перевірено.
- Npm-еквівалент старого `make verify` повністю PASS (make не встановлений):
  lint/color/timing/tilecraft/live GPU/tilecraft GPU/story UI/Bake/build.
  Нові unit/GPU checks теж PASS, внесені в Makefile й SDLC.
- Фінальні JSON/PNG: `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-5trTfc/`;
  stdout: `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-final-gpu.log`. Локальні
  тимчасові докази не комітити; runner створює новий temp run при повторі.
- URL і точні кліки — у QA. Eval сервери закриті; 3000 EACCES, 8087 зайнятий,
  застосовано перевірений 62865. Чужі процеси збережені. Deploy не виконувався.
- A прийнята й закрита власником. Наступна реалізація — B; policy HEX і
  White/Black зафіксована в спеці. Snapshot discovery — задача агента B,
  не owner-рішення й не gate входу. Фізичне GPU-покриття лишається неперевіреним.

## Головні виміряні факти

- Попередній розбір 2026-10-13: `node debug/color-parity-test.js` — 42/42.
  Це baseline до патчу, не поточний eval і не доказ незмінності полотна.
- Поточні маніфести: 19 engine + 3 app = 22 потрібні шейдери.
- На диску 24 shader-файли сумарно 42 206 байтів; два picker-файли не входять
  у чинний набір застосунку. Кількість не повинна стати hardcoded guard.
- Причини підтверджені кодом: глобальне декодування текстури через
  `colorModel` і окреме XHR-завантаження; `304` не усуває запит.
- Спека фіксує кодування `[1-g, 1-r, 1-b]` та постійний RGB-рендерер.
  Попереднє Natural-змішування не зберігається побайтно (§3.1).
- Перевірка defaults після уточнення fluidity до `0.7`: `npm run build`
  — PASS, `npm run test:story-ui` — PASS; тест звіряє значення engine і UI.

## НЕЗАКРИТЕ — почни звідси

~~1. **Фаза A — адаптер кольору та ізольована GPU-проба.**~~ — **ЗАКРИТО 2026-10-13**, прийнято власником.

   Контракт: спільне кодування відтворює базовий RGB обох палітр, White/Black
   та прямого HEX через наявний RGB-рендерер; production-поведінка поки чинна.
   Це ізольована перевірка ризикованого рішення, не часткова міграція полотна.

   Читати: спека §3.1, §3.3, §5 P1; `app/ui/ryb.js`,
   `fluid-engine/shaders/painting.frag`, `fluid-engine/renderer.js`,
   `fluid-engine/index.js`, `debug/color-parity-test.js` і чинний GPU-harness
   `debug/bake-gpu-test.js` / `debug/live-gpu-test.js`.

   Робота: додати спільний адаптер без підключення нового формату до ручних
   та story-мазків; додати самодостатню GPU-пробу і unit-перевірки адаптера.
   Probe має порівнювати engine pixels при однакових simulation steps,
   включно з запуском, де вибір палітри змінюється без нового внесення.
   Визначити й обґрунтувати float/half-float допуск.

   Guard: `npm run test:color`, `npm run lint:shaders`, `npm run build`,
   `npm run test:color-adapter`. GPU probe: `npm run test:color-adapter:gpu`.
   Реалізація й eval PASS; власник прийняв A через `handoff:next`.
   Probe: нова ізольована GPU-проба — декодування й незмінність матеріалу
   при зміні палітри; чинний застосунок після додавання адаптера запускається.

   Виконані сценарії QA-A1…A8, точні URL, допуски та докази — [QA.md](./QA.md).

   Закриття: адаптер і GPU-проба працюють; жоден production producer не
   записує новий формат під старий renderer. Додати фактичні докази в QA.

2. **Фаза B — наскрізна інтеграція незалежної палітри.**

   Залежить від A. Контракт: весь застосунок використовує один формат
   полотна, а Natural / Digital змінює тільки палітру майбутніх мазків.
   Не залишати змішаний стан старих story payload і нового renderer.

   Читати: спека §3.2–§3.5, §5 P1; `paint.js`, `app/ui/color.js`,
   `app/ui/ryb.js`, `app/ui/panel.js`, `app/story-playback-controller.js`,
   `app/fluid-control-api.js`, `fluid-engine/tilecraft-stroke-player.js`,
   `debug/tilecraft-story-gpu-test.js`, `debug/fluid-control-api-test.js`,
   `debug/bake-gpu-test.js`, документи кольору, названі в §3.5.

   Робота: єдиний palette setter, фіксація кольору на початку мазка,
   постійна RGB-модель screen/resize/export/Bake, усі ручні й програмні
   producers, точний HEX override, preview/readout, Undo/Redo та PNG-фон.
   HEX, White і Black зберігають точний RGB при перемиканні палітри; ручна
   зміна H/S/V задає новий колір, White/Black замінюють попередній override.
   Зміна alpha не скидає точний RGB. Це закритий контракт, не owner-gate.
   Story UI зберігає поточні блокування; engine defaults інших хостів
   залишаються сумісними. Оновити документацію кольору.

   Guard: `npm run test:color`, `npm run lint:shaders`,
   `npm run test:tilecraft`, `npm run test:story-ui`,
   `npm run test:fluid-control`, `npm run build`, перевірки адаптера з A.
   Probe: GPU-регресія перемикання в реальному Paint, `npm run test:bake`,
   `npm run test:tilecraft:gpu` та browser-перевірка HEX/API. Перевірити
   `examples/minimal` зі старим контрактом engine.

   Чернетка QA-B1:
   **qa:open:** `http://localhost:3000/` після `npm run dev`.
   **qa:action:** намалювати мазок у Natural і вибрати Digital.
   **qa:inspect:** попередній мазок та палітра в панелі.
   **qa:expected:** палітра змінилася, колір старого мазка лишився тим самим.
   Додаткові окремі сценарії: зворотне перемикання, новий мазок, Undo/Redo,
   export/Bake, story HEX та control API. Створити й виконати їх до review.

   Закриття: усі §5 P1 виконано; export pixels ідентичні до/після перемикання
   без simulation steps, а в активній симуляції збігаються два
   детерміновані прогони. Компроміс Natural-змішування описано.

3. **Фаза C — шейдери в bundle, source loader та dev watch.**

   Патч P2 незалежний від P1 технічно; у цьому плані виконується після B.
   Контракт: production та dev bundle містить повний набір потрібних
   шейдерів, source mode зберігає файлове завантаження з явними помилками.

   Читати: спека §4, §5 P2, §6; `gulpfile.js`, `common.js`,
   `fluid-engine/gl/wrappedgl.js`, `fluid-engine/gl/glsl3.js`,
   `fluid-engine/index.js` (маніфест), `paint.js` (ініціалізація),
   `examples/minimal/minimal.js`, `DEPLOY.md`, `docs/SDLC.md`, `Makefile`.

   Робота: build-реєстр з наявних маніфестів, генерація перед scripts,
   повні фізичні ключі й чинні логічні ключі engine, registry-first loader,
   error propagation та source fallback лише за відсутності реєстру,
   watch шейдерів/маніфестів, документація. Не мінімізувати GLSL.

   Guard: `npm run lint:shaders`, `npm run build`, нові перевірки повноти
   реєстру, колізій, порожніх/відсутніх файлів і loader completion/errors.
   Не рахувати шейдери фіксованим числом: перевіряти рівність маніфесту.
   Probe: browser із заблокованими shader URLs малює, має 0 таких запитів;
   WebGL1/WebGL2 screen/resize/save; source example, dev rebuild та
   контрольовані помилки. Наприкінці — обов'язкові checks із `docs/SDLC.md`.

   Чернетка QA-C1:
   **qa:open:** `http://localhost:3000/` після `npm run dev`, Network відкрито.
   **qa:action:** очистити Network, перезавантажити сторінку й намалювати мазок.
   **qa:inspect:** полотно, Console та Network з фільтром shader-файлів.
   **qa:expected:** мазок видно, помилок немає, запитів `.frag` / `.vert` — 0.
   Окремий автоматизований сценарій повинен блокувати shader URLs, а не
   покладатися на кеш. URL source example перевірити на реальному source server.

   Закриття: усі §5 P2 виконано, повна регресія перевірена; незалежні P1/P2
   зміни мають окрему історію review/комітів. Deploy не виконувати.

## Закриті рішення та технічні задачі B/C

Owner-питань для входу в B немає. Рішення за уточненням власника й
`handoff:next` 2026-10-13:

- **Black/White:** точний базовий RGB `[0,0,0]` / `[1,1,1]`, без Natural
  inverse/повторної конверсії. Перемикання палітри не змінює цей вибір або
  вже внесений матеріал. Lighting не записувати у колір матеріалу.
- **HEX:** точний RGB зберігається при перемиканні Natural/Digital; ручна
  зміна H/S/V задає новий palette-колір; White/Black явно замінюють override
  на відповідний точний endpoint. Alpha сама по собі RGB не змінює.
- **Snapshots:** політика закрита — старий формат не трактувати мовчки як
  новий. Агент у B перевіряє міжсесійні entry points; якщо вони є, версіонує
  або мігрує за §3.4. Наявність такого шляху ще не встановлена; це технічна
  перевірка, не рішення власника і не привід блокувати початок B.
- **Loader C:** агент обирає error callback або Promise за сумісністю
  чинних callers; точна реалізація має забезпечити §4.2. Обидва способи
  дозволені контрактом, owner-gate не потрібен. API реєстру — деталь C.
- **GPU:** допуск A закритий у QA: decode 1 byte, invariance 0. SwiftShader
  float/half-float перевірено; фізичні пристрої не перевірено. Це retained
  coverage debt, не відкрите питання і не фізичний PASS.

## Правила наступних фаз

На `handoff:start fluid-2` прочитати цей файл цілком,
назвати наступну фазу й чекати команди почати за скілом handoff.
На фазуванні жодні eval, сервери, runtime-правки або commit не запускалися.

`app/QA.md` створено у A: QA-A1…A8 мають перевірені URL/команди та результати.
Чернетки B/C нижче лишаються планом, не виконаними сценаріями.
Нові секції наступних фаз вставляти згори; сервери, запущені агентом,
зупиняти перед review. Рядок автодеплою не додавати: deploy поза scope.

Окремого `INVARIANTS.md` тема зараз не має. Фазові guard/probe задані вище;
якщо створюється файл інваріантів, зареєструвати його в `AGENTS.md` та
зафіксувати походження правил від цих двох дефектів.

Закриті фази закреслювати, не видаляти. Після кожної фази оновлювати
«Далі», факти й Git-стан лише за фактичними результатами. Commit — після
команди власника `handoff:next`; автономний конфіг цим викликом не замовлено.

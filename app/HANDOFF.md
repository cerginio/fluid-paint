# Handoff: fluid-2

Стан на 2026-10-14. Гілка під час фазування: `feat/brush_shapes`.
План і defaults закомічені в `a0ea507`. Фаза A прийнята власником і
закрита командою `handoff:next` 2026-10-13; її код і документи входять
у closing commit цієї фази.
Фаза A закомічена в `df381ba`. Фаза B прийнята власником і закрита
командою `handoff:next` 2026-10-13; код і closure-документи входять
у closing commit B (`721d990`). Фаза C прийнята власником через
`handoff:next` і закрита 2026-10-14; код і closure-документи входять
у closing commit C.
Спека: [PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md](../docs/PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md).
Тема локальна для цього репозиторію; зовнішній Tilecraft та vendored
transport/model/bridge не змінювати.

Після фазування власник перейменував тему на `fluid-2` і окремо замовив
нові стартові defaults застосунку: fluidity `0.7`, bristles count `12`,
brush size `12`. Ці зміни в `paint-setup.js` / `paint.js` не є виконанням
фаз A–C; engine defaults інших хостів лишаються чинними.

> **Далі:** A–C та release follow-up завершено й прийнято власником.
> Production: https://fluid.storytilecraft.space/?webgl=2&debug=none&diag=0&seed=41
> C: `d636098`; release follow-up прийнято через `handoff:next` 2026-10-14.
> Нової фази не призначено; чекати наступного завдання.
> Попереднє обмеження deploy поза scope стосувалось A–C; цей deploy
> явно дозволено власником окремо. Physical GPU/mobile debt збережено.

## Release / production QA — 2026-10-14

- Власник дозволив виправлення тесту та production deploy для QA.
- `debug/story-player-ui-test.js` звіряє engine/UI з `INITIAL_*` конфігом,
  без hardcoded brush size 12. Production default 32 уже в `c2a537d`.
- Повний npm-еквівалент `make verify` PASS, включно зі story UI та Bake;
  color 42/42, adapter 6/6, shader unit 25/25. Фінальний production build PASS.
- Netlify site `79a5d98c-0ff5-47fd-b048-64d714854ff9`;
  deploy `6acf2dc4387e01034f6d18d8`, production https://fluid.storytilecraft.space.
  Immutable URL: https://6acf2dc4387e01034f6d18d8--fluid-paint.netlify.app.
- Readback production index.html/bundle.js/app/layout.css: HTTP 200,
  побайтно рівні локальному verified dist. Browser smoke: engine ready,
  brush size 32, registry present, 0 shader requests, pageerrors [].
  Screenshot/result: `C:/Users/cergi/AppData/Local/Temp/fluid-prod-qa-vCqdcH/`.
- Це startup smoke на SwiftShader, не production draw/resize/Save або
  physical GPU PASS. Повні draw/resize/Save перевірки пройшли локально.
- Release follow-up прийнято власником через `handoff:next` 2026-10-14;
  A–C не перевідкривали. Closing rerun `npm run test:story-ui` PASS,
  `git diff --check` PASS. Повний gate і production smoke вище — результати
  перед deploy; зараз їх повторно не запускали. Retained coverage debt
  не перетворено на physical GPU або production draw/resize/Save PASS.

## Що зроблено і працює

| Файл | Стан |
| --- | --- |
| `docs/PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md` | Контракт двох патчів, межі, сумісність і приймання. |
| `paint.js`, `app/ui/color.js`, `app/ui/ryb.js` | B: `paletteMode`, точний RGB override, shared `_paintRgb()` для мазка й обох previews; screen/resize/export/Bake завжди RGB. |
| `app/story-playback-controller.js`, `app/fluid-control-api.js`, `fluid-engine/tilecraft-stroke-player.js` | B: story/control HEX точні; story інжектує shared adapter. Standalone player лишається legacy-pigment за замовчуванням. |
| `gulpfile.js`, `debug/shader-bundle-build.js` | C: registry з чинних manifests перед scripts; unminified GLSL, physical/logical collision та missing/empty build errors; serialized shader/manifest watch. |
| `common.js`, `fluid-engine/gl/wrappedgl.js`, `paint.js`, `examples/minimal/minimal.js` | C: registry-first без fallback за присутнього реєстру; source HTTP/network/timeout/abort/HTML errors, once-only completion та видимі init errors. Engine I/O не додано. |
| `debug/shader-bundle-test.js`, `debug/shader-bundle-gpu-test.js` | C unit/actual negative Gulp builds і production/dev/source браузерна проба; npm/Makefile/SDLC інтегровані. |
| `AGENTS.md` | Тему зареєстровано з цим HANDOFF. |

Таблицю оновлено за реалізацією C; власник прийняв C через `handoff:next`.
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

## Фаза B — прийнята й закрита 2026-10-13

- Усі producers застосунку використовують encoded RGB; engine API/defaults
  інших хостів не змінено. Story отримує `encodeRgb` callback спільного
  `PaintColorAdapter`; dependency-free player має сумісний fallback.
- Виправлено пропущений exact HEX у brush center marker/brush viewer: обидва
  production draw paths і `_strokeColor()` беруть один `_paintRgb()`.
  Прибрано старе попередження story UI про перефарбовування матеріалу.
- Світлий/темний endpoint і HEX переживають перемикання та alpha; H/S/V
  замінює override. Engine копіює color при beginStroke; чинний мазок не
  змінюється. Palette setter не змінює textures, history або dry PNG.
- Свіжий guard: color 42/42, adapter 6/6, shader lint, tilecraft, story UI,
  fluid-control, build — PASS. Повний npm-еквівалент `make verify` також PASS:
  timing, live GPU, tilecraft GPU, Bake, adapter GPU, Paint palette GPU, build.
  `commands.json` містить 14 виконань (13 різних команд; build двічі), exit 0.
  Додатковий фінальний Paint rerun із відкритою Player-панеллю теж exit 0:
  `test-paint-palette-gpu-final.log` у тому самому каталозі.
  Не підсумовувати assertion scripts як вигадану загальну кількість tests.
- Реальний Paint: 3 deterministic пари Natural/Digital/mixed × 30 steps;
  frozen та active raw/export delta **0**. Ідентичний initial material
  snapshot + clear dynamics + fixture velocity `[2,1]` на одному engine,
  синхронно без RAF між runs. Material movement > 2; це не фізичний GPU PASS.
  Старий незавершений probe порівнював різні engine instances з допуском;
  його замінено exact same-initial-state методом, не розширено допуск.
- Undo/Redo delta 0; overlap змінює матеріал; palette не змінює history index.
  Resize preview RGB; після resize switch raw/export delta 0. Реальний PNG
  load, background switch і Bake delta 0; wet magnitude після Bake 0.
  PNG blobs до/після switch ідентичні. Story natural/digital play+restart:
  4 payloads з точним `#3B82F6`; completed restrictions збережені.
  Minimal source host малює legacy pigment, render model 0, app adapter відсутній.
- Snapshot discovery: пошук storage та snapshot entry points у JS застосунку
  й engine знайшов тільки in-memory Undo ring/story baseline GPU textures;
  file load — story JSON або PNG, export — PNG. Persisted material reader не
  знайдено, міграцію не вигадували. Це source audit цього repo, не доказ
  відсутності історичних даних/зовнішніх невідомих hosts. Майбутній формат
  потребує `materialFormat`; old pigment texture не можна мовчки імпортувати.
- Докази Paint: `C:/Users/cergi/AppData/Local/Temp/fluid-2-B-ZRvNIZ/result.json`
  та `paint-palette-main.png`, `paint-palette-active.png`, `paint-palette-hex.png`,
  `paint-palette-story.png`, `minimal-legacy.png`, `paint-export.png` поруч.
  Свіжий adapter GPU: `C:/Users/cergi/AppData/Local/Temp/fluid-2-A-KGmio0/`
  (4 режими, 68 decode checks ≤1 byte, 12 pairs delta 0, source/build smoke).
  Stdout/stderr/exit codes: `C:/Users/cergi/AppData/Local/Temp/fluid-2-B-finish/`.
- QA-B1…B9 у [QA.md](./QA.md). Сервери probes закриті, порти 52290/49155
  перевірено bind-back; чужі сервери не зупиняли. Артефакти тільки у Temp.
  Physical GPU/mobile visual acceptance не перевірено; власник прийняв B
  через `handoff:next` зі збереженням цього coverage debt. Компроміс Natural
  mixing з §3.1 збережено. Deploy/C не виконували.
- Closing rerun батьківського агента: усі guard B, Paint probe, Bake і
  tilecraft GPU — PASS; color 42/42, adapter 6/6. Paint JSON/PNG:
  `C:/Users/cergi/AppData/Local/Temp/fluid-2-B-MuagKi/`; 3 пари ×30 steps,
  frozen/active raw/export delta 0. Перед commit index порожній.

## Фаза C — прийнята й закрита 2026-10-14

- Build helper читає й виконує **наявні** engine/app manifests у Node VM;
  третього списку немає. `dist/.build/shader-registry.js` генерується після
  clean, перед scripts, і йде першим у bundle. Ключі фізичні, `shaderSources`
  лишаються логічними. Тексти source й production registry побайтно рівні.
- `FLUID_SHADER_SOURCES` присутній → лише registry; missing/blank/type error
  → init error, 0 XHR fallback. Source loader перевіряє 2xx, blank/HTML,
  network/abort/30s timeout, відкриття/відправлення; completion success/error
  один раз, у тому числі empty files/trees. Paint показує role=alert,
  minimal — status; за load error engine не створюється.
- Guard: shader unit **25/25**, color **42/42**, adapter **6/6**, lint і build
  PASS. Missing/empty/collision перевірено не лише helper: справжні `gulp build`
  у Temp fixtures повернули ненульовий exit і не створили bundle.
- Probe PASS: WebGL1 і WebGL2 production, shader routes **заблоковано**, кожен
  має **0 shader requests**, material delta `1.3786293268203735` після мазка.
  Screen PNG показує матеріал; resize preview/commit GL errors 0; Save As…
  через реальний button завантажує PNG по 5173 bytes. Registry keys рівні
  manifest, усі GLSL string contents точні (поточний набір 22, не hardcoded).
- Source Paint/minimal: 22/19 запитів, обидва малюють; старий engine host
  лишається pigment. Controlled registry/404/network/HTML200/minimal404
  показують конкретний `splat.vert`, без pageerrors та без engine.
- Реальний Gulp serve/watch на випадковому порту: shader comment потрапив у
  bundle; доданий у тимчасовий app manifest `picker.vert` потрапив у registry
  й bundle. Обидві source правки відновлено; restored bundle **точно рівний**
  початковому dev bundle. Dev Paint теж малює із заблокованими routes, 0 XHR.
- Повний npm-еквівалент актуального `make verify` + fluid-control PASS:
  `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-finish/commands.json` містить
  **16 виконань, 15 різних команд, усі exit 0** (build двічі); поруч окремі
  stdout/stderr. Make на цьому хості відсутній. Browser suites запускалися
  послідовно під чинним browser lock; Node `v24.19.0`.
- Фінальна C-проба: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-gQmano/result.json`,
  `production-build.log`, `dev-watch.log`, `bundle-webgl{1,2}-{screen,resize,save}.png`,
  `source-{paint,minimal}.png`, `error-{registry,http404,network,html200,minimal404}.png`,
  `dev-bundle.png`. Точні URL й реально виконані кроки — QA-C1…C14.
- Negative Gulp evidence: Temp `fluid-2-C-build-missing-G8z3Em`,
  `fluid-2-C-build-empty-JrEJhS`, `fluid-2-C-build-collision-dsavOG`;
  кожен має `stdout.log`, `stderr.log`, `result.json`. Evidence не в repo.
- C server/dev закриті; **51086/50095 bind-back PASS**. Усі запущені eval
  servers закривали власні runners; чужі процеси не зупиняли.
  Додатковий фінальний bind-back усіх записаних C/A/B портів (включно з
  попередніми C attempts), empty index, незмінний HEAD і `git diff --check`:
  Temp finish `final-verification.json` — PASS.
  Generated artifacts лишаються ignored у dist; QA evidence тільки Temp.
- Physical GPU/mobile visual coverage debt A/B збережено. Ці цифри —
  Chromium/SwiftShader, не фізичний GPU PASS. Palette redesign, vendored і
  зовнішній Tilecraft не змінювались. На review 2026-10-13 commit/deploy/owner
  acceptance ще не було; C прийнята 2026-10-14, deploy не виконано.
  Abort/30s timeout події перевірено unit, не окремим browser fault injection.

- Незалежний rerun батьківського агента перед review: shader lint, shader
  unit 25/25, повна C browser/watch-проба й фінальний production build — PASS.
  JSON/PNG: `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-WscaUV/`.
  WebGL1/2: 0 shader requests, resize GL errors 0, реальний Save PNG;
  source/minimal та всі контрольовані UI errors PASS. Screen і saved PNG
  переглянуто: ненульовий синій матеріал видно. Порти 49271/52872 та
  попередні 50095/51086 перевірено bind-back; index порожній, HEAD `721d990`.

### Closing journal C — 2026-10-14

- Власник прийняв C через `handoff:next`. Свіжі lint, shader unit 25/25
  і production build PASS. Повторна повна C browser/watch-проба PASS:
  `C:/Users/cergi/AppData/Local/Temp/fluid-2-C-EeUP4P/result.json`.
  WebGL1/2 draw/resize/Save: 0 shader requests, GL errors 0; source/errors,
  shader/manifest watch і exact dev restore PASS; cleanup 63897/52845 PASS.
- Перший closing probe `fluid-2-C-5GcOoL` мав timeout manifest bundle rebuild
  після успішного registry rebuild; повтор без змін коду PASS. Причину
  не встановлено, intermittent watch/probe failure збережено як debt.
- Повний SDLC прогін вище історичний, зараз не повторювався. Physical
  GPU/mobile та browser abort/timeout coverage debt збережено.
- Окрему сторонню зміну `paint-setup.js` (brush size 12 → 32) не включати
  в closing commit C. Сервер власника на 62865 не зупиняти.

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

~~2. **Фаза B — наскрізна інтеграція незалежної палітри.**~~ — **ЗАКРИТО 2026-10-13**, прийнято власником.

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

   Виконані QA-B1…B9: exact Paint GPU, readout/previews, history/resize,
   PNG/Bake, story/API та minimal compatibility — див. QA.md і докази вище.

   Закриття: усі §5 P1 виконано; export pixels ідентичні до/після перемикання
   без simulation steps, а в активній симуляції збігаються два
   детерміновані прогони. Компроміс Natural-змішування описано.

~~3. **Фаза C — шейдери в bundle, source loader та dev watch.**~~ — **ЗАКРИТО 2026-10-14**, прийнято власником.

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

   Виконано QA-C1…C14: production WebGL1/2 з blocked shader routes, actual draw,
   screen/resize/Save, source Paint/minimal, controlled errors, actual shader
   та manifest dev rebuild, unit/negative build і повний SDLC — [QA.md](./QA.md).
   Результати й evidence вище. **C прийнята; наступної фази не призначено.**

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
  або мігрує за §3.4. Scoped source audit B не знайшов persisted material
  reader; знайдено in-memory history/story textures, story JSON і PNG.
  Це не гарантія для невідомих зовнішніх hosts; докази й межі наведено вище.
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
QA-B1…B9 виконано у B; QA-C1…C14 виконано у C, C прийнята 2026-10-14.
Нові секції наступних фаз вставляти згори; сервери, запущені агентом,
зупиняти перед review. Рядок автодеплою не додавати: deploy поза scope.

Окремого `INVARIANTS.md` тема зараз не має. Фазові guard/probe задані вище;
якщо створюється файл інваріантів, зареєструвати його в `AGENTS.md` та
зафіксувати походження правил від цих двох дефектів.

Закриті фази закреслювати, не видаляти. Після кожної фази оновлювати
«Далі», факти й Git-стан лише за фактичними результатами. Commit — після
команди власника `handoff:next`; автономний конфіг цим викликом не замовлено.

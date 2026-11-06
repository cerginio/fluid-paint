# Fluid Play / Rescript — мобільні панелі обох репозиторіїв

Статус: зріз MU-1 anchor/disclosure/chevron прийнято до commit через `handoff next`; return→extension лишається незакритим (останній browser runner FAIL). MU-2/MU-2G/MU-3 ще не реалізовано. Фактичні результати та докази — у канонічному HANDOFF.
Тема: **існуюча `fluid`**, не нова тема і не перевідкриття завершених `fluid-2` A–C.
Канонічний план: [HANDOFF теми fluid](../../../js-games/ua-dream/docs/spec/fluid-paint/HANDOFF.md), фази MU-1…MU-3.
Команда власника `Handoff continue fluid` дозволила реалізацію MU-1. Це не приймання QA, дозвіл на commit/deploy або автоматичний перехід до наступної фази.

## 1. Карта відповідальності

- **Fluid Paint**, `D:/work/fluid-paint/fluid-paint`: `app/ui/panel.js`, `app/ui/color.js`, `app/layout.css`, `index.html`; за необхідності лише wiring у `paint.js`. Власник floating native tools, grip, collapse, picker layout і clamp.
- **Tilecraft**, `D:/work/js-games/ua-dream/tilecraft`: `index.html` (CSS та DOM `#gamification`, `#fluid-mode-controls`), `fluid-modes.js`; регресії `tests/fluid-mode-ui.test.js`, `tests/gamify-command-registry.test.js`, пов’язані fluid tests. Власник wrapper Play/Rescript, responsive shell, статусів та меню.
- Необхідність зміни vendored transport/model/bridge визначається мінімальним layout-контрактом MU-2 (§4.2). Не змінювати тільки одну копію; перед runtime-правками описати сумісне передавання host bounds через чинний перевірений канал.
- Документи теми та її історія залишаються у `ua-dream/docs/spec/fluid-paint/`. Ця спека навмисно живе у Fluid Paint як контракт його native UI та обох боків інтеграції.

## 2. Докази й межі

### 2.1 Вхідні скриншоти власника

Проаналізовано п’ять JPEG із повідомлення: `img_d20fc192ebb2.jpeg`, `img_76dd55edb1ad.jpeg`, `img_ab75e01bdec9.jpeg`, `img_e5c56f241bb4.jpeg`, `img_f0e9b0bc47b1.jpeg` (оригінали надані в Hermes cache).

Видиме: wrapper розтягується на окремі смуги заголовка, основних контролів, дій і статусу/закриття; немає вирівняної компактної осі; великі порожні зони; нативна панель стартує під wrapper, після ручного переміщення вправо обрізається; grip схожий лише на drag affordance. Пара знімків нижньої панелі показує різні позиції, але сама по собі не встановлює алгоритмічну причину дрейфу. Розміри JPEG не прирівнювати до CSS viewport/DPR телефона.

### 2.2 Відтворення на живому source-коді

Source revisions на вході: Fluid Paint `c978486`, ua-dream `d2dec2bf`. У Fluid Paint вже були сторонні незакомічені зміни `docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md` і `docs/spec/fluid-session/HANDOFF.md`; вони не входять у цю роботу. Ua-dream на вході clean.

Використано наявний `scripts/guide-workbench-server.mjs --port 41780`, `http-server` Fluid Paint на 41871, встановлений `playwright-cli`, одну Chromium session. Живий Tilecraft відкритий за `http://127.0.0.1:41780/?pack=default&lang=en&layout=v2`. Мишею намальовано 14 тайлів у кадрі 1; режими відкриті реальним `openFluidMode(mode,{frameId:1,fluidUrl:'http://127.0.0.1:41871/index.html?debug=none'})`, працюють handshake та Play/Rescript. Не підміняли API вигаданими відповідями.

Висота wrapper у CSS px, по два режими на кожен viewport:

- 360×800: Play **235**, Rescript **235**.
- 390×844: Play **235**, Rescript **235**.
- 412×915: Play **187**, Rescript **235**.
- 844×390: Play **54**, Rescript **102**.
- 1280×800: Play **54**, Rescript **54**.

Це 10 runtime-вимірів, desktop Chromium viewport emulation, не physical-mobile/Safari acceptance. На 390 px wrapper має ширину 366 px; native tools після Tools мають `x=56`, `right=422` при viewport 390: частково виходять вправо та сховані за host wrapper.

Дрейф перевірено окремо з очікуванням 200 ms після кожної дії: native bar спочатку одноразово поставлено API внизу (`moveTo(12,720)`), потім 10 справжніх locator-click по grip. Collapsed `bar.top`: **721 → 695 → 669 → 643 → 617 → 591**. П’ять повних циклів дають **−130 px**, тобто −26 px/цикл. При відкритті picker width 174, при закритті 200, slot width 0. Швидкий синхронний цикл без frame/observer settlement дрейф не показав — такий unit/probe сам по собі недостатній.

Збережені результати та screenshots: `D:/work/js-games/ua-dream/tilecraft/.pw-probe/evidence/fluid/MU-0/mobile-panels-20261106/manifest.json`. У manifest — source hashes, provenance, метод і обмеження. Runtime logs містили фонові warnings редактора і 404 service-worker; перша спроба відкрити ще неготовий source-server дала connection-refused/handshake timeout. Після готовності серверів обидва режими працювали; ці setup-помилки не класифіковано як нові дефекти Fluid.

## 3. Діагноз за кодом

### D1. Висока багаторядкова оболонка — не проблема лише gap

`tilecraft/index.html:282–346`:

- outer `#fluid-mode-controls` — `display:flex; flex-wrap:wrap; width:max-content`;
- до 640 px title отримує `width:100%`, тому гарантовано займає власний рядок;
- вкладені `#fluid-play-controls` / `#fluid-rescript-controls` теж `flex-wrap:wrap` та center;
- палітра з шести 38 px кнопок, range 120 px, labels/readouts, окрема група Tools/Save або Clear/Save мають власні intrinsic widths;
- статус і Close — siblings mode-controls, не частина єдиної осі; статус розтягується `flex:1`;
- у range успадковані загальні min-height/border/background для input: зайва важка рамка навколо повзунка.

Отримуємо вкладений перенос із центрованими «острівцями», статусом у хвості й випадковими розривами. При 412 px Play раптом стає нижчим, а Rescript ні. Зменшити font-size або transform:scale — не виправлення структури й погіршує touch.

### D2. Немає спільного layout ownership

`#gamification-frame` заповнює overlay; host toolbar абсолютно позиціонований над ним. Native `#ui` починається на `left/top=12/16px` незалежно всередині iframe. `fluid-modes.js` не резервує місце для дитячого UI; Tools лише викликає `configureUi(empty | draw-full + state-bake)`. У Rescript `app/fluid-control-api.js` встановлює `draw-min`, тому native bar з’являється навіть без Play Tools. Z-index у дочірньому документі не може обійти host overlay; підвищення native z-index не вирішує проблему.

Додатково `ToolPanel` викликає `setCollapsed(true)` у constructor, коли preset може приховувати root. `_clampPosition()` читає width=0, minimum visible=56 і `moveTo` записує inline x=56; після появи root шириною 366 він виходить за 390. Це підтверджене відтворення hidden-layout дефекту, не вимога повністю заборонити користувацький offscreen drag.

### D3. Дрейф — асинхронна зміна body + DOM як джерело істини

`app/ui/panel.js:78–84,177–188,223–224`: collapse читає поточний `bar.getBoundingClientRect().top`; `moveTo` обчислює rootTop із **миттєвих** rootHeight і barHeight. Стабільного бажаного anchor немає; після reflow останній змінений DOM top стає новою «позицією користувача».

`app/ui/color.js:155–172`: ResizeObserver бачить прихований slot width=0, `_measureWidth()` повертає fallback **200** і `_resize()` реально змінює picker. При відкритті slot ≈173.67 → picker **174**. Expanded root спершу 438 px, після observer — 412 px. При body above rootTop лишається попереднім: bar іде вгору. На наступному collapse ця зсунута позиція зберігається. Border accounting додає окрему похибку 1 px, але не є поясненням усіх 26 px.

### D4. Disclosure не позначений і недоступний з клавіатури

`index.html:45`: main grip — div із трьома порожніми span. `app/layout.css:335–355` малює дев’ять крапок через shadow. Є tooltip «Drag to move, tap to collapse», але немає chevron, role/button semantics, tabindex, aria-expanded. `panel.js` має keydown Enter/Space лише для extensionGrip, не для main grip. Дотик уже вміє collapse, але UI його не пояснює. `pointercancel` зараз проходить той самий tap-end path: скасований жест не повинен раптово перемикати disclosure.

## 4. Запропонований UX-контракт

### 4.1 Tilecraft: один primary row, решта — явне розкриття

На вузькій/coarse-mobile оболонці **одна primary toolbar-смуга**, без повного текстового заголовка окремим рядком і без окремого footer статусу. Не намагатися втиснути шість кольорів, три transport-кнопки, speed/range, Tools, Save, title та Close одночасно. Усе це фізично не вміщається в 320–390 CSS px із нормальними touch targets.

Рекомендована композиція:

- Play: `[режим/меню] [Play↔Pause] [Restart] [Tools] [More] [Close]`.
- Rescript: `[режим/меню] [колір] [розмір] [Clear] [More] [Close]`.
- Усі шість слотів мають hit-area **44×44 CSS px**, gap 4 px; внутрішні поля 8 px. Мінімальна смуга 300 px, вкладається у 320 px із зовнішніми полями. Вузький title не потрібен: mode icon має доступне ім’я Fluid Play/Fluid Rescript; видимий label можна показати лише там, де він уміщується без переносу.
- More у Play: Save, speed, thickness з числовим readout. More у Rescript: Save та native-tools visibility. Колір відкриває наявні шість swatches; розмір — range з чинним діапазоном. Функції не прибирати, не замінювати їх безіменними іконками.
- Play/Pause — один видимий слот, але зберегти окремі чинні control commands та правила canPlay/canPause. Для completed/ready/error не виводити state із тексту status. Disabled, working/error semantics залишаються явними.
- Status: компактний маркер у mode-slot із accessible live status, повний текст у disclosure; error показує зрозуміле повідомлення, а не лише колір. Close завжди видимий і працездатний, навіть під час loading/error.
- SVG для видимих дій, currentColor, text alternative, focus-visible; destructive Clear потребує зрозумілої назви. Без transform/zoom чи мікрокнопок для «одного рядка».
- Primary row не прокручується горизонтально: Close і transport не мають ховатися за scroll.
- На desktop залишити поточну повнофункціональну смугу й drag; icon/shared semantics можна уніфікувати без обов’язкового redesign широкої версії.

Важливо: «один рядок» означає primary controls у спокійному стані. Опційний відкритий tray — навмисна вторинна поверхня, не постійні 3–4 ряди chrome.

### 4.2 Геометрія без перекриття: fullscreen iframe та дві overlay-панелі

**Рішення власника:** iframe залишається full screen. Tilecraft — плаваюча pop-панель зверху поверх iframe; нативна Fluid-панель початково розміщується **у самому низу viewport**, а не безпосередньо під Tilecraft. Попередню пропозицію stacking «панель → зменшений iframe» відхилено. Не скорочувати canvas/painting rectangle, не додавати layout-рядок над iframe, не вимикати host drag заради цього рішення.

- Host передає дитині актуальну зайняту панеллю область у CSS px відносно iframe viewport. Нативна панель використовує її як exclusion region лише для UI; engine, canvas і координати малювання не змінюються.
- При entry та першій появі native tools bar прив’язаний до самого низу видимого viewport з safe-area/gutter, body розгортається вгору. Це правило і для Play, і для Rescript. Повторні collapse/expand/Tools hide-show не піднімають панель і не гублять її валідну user-position; поворот перераховує нижній anchor без зміни iframe.
- Host drag, native drag, collapse/expand, tray open/close, viewport rotation та зміна status/error text актуалізують геометрію. При колізії коригується resolved native position; бажаний user anchor зберігається окремо, щоб уникнення перекриття не накопичувало дрейф.
- Розгорнута native body теж не повинна заходити під host: напрямок і доступна висота враховують exclusion region; за браку висоти body скролиться, grip лишається досяжним. Не зменшувати iframe як fallback.
- Tray — тимчасова overlay-поверхня host, а не окрема layout-область. Одночасно один tray, явний dismiss/Escape/повторний tap; bounded висота та внутрішній scroll. Її видимі bounds входять у зайняту область host. Focus повертається до trigger.
- Safe-area та visualViewport offsets враховувати без подвоєння; не плутати CSS px із backing pixels. Зміна UI не reload iframe/scene і не змінює aspect-fit малюнка.
- Mobile detection охоплює portrait та coarse-touch landscape; не змінювати глобальну поведінку fire/hammer/book/PDF чи інших споживачів overlay.

**Технічна залежність MU-2:** перевірити чинний configureUi/bridge і вибрати мінімальний сумісний спосіб передати bounds host → child. Це ще не реалізований API; попереднє твердження «координація/RPC точно не потрібні» більше не чинне. Якщо потрібне адитивне розширення layout-контракту, описати payload, валідацію, legacy fallback і lifecycle до runtime-правки; канонічні та vendored копії оновлювати разом. Не використовувати довільний postMessage в обхід чинних origin/peer перевірок.

### 4.3 Fluid Paint: стабільна координата ручки

- Зберігати **бажану screen-space позицію bar/grip** як стан, змінюваний лише drag або свідомим viewport clamp; не виводити нове бажане положення з DOM після кожного toggle.
- Окремо мати resolved visible layout: collapse state, effective direction above/below, rootTop/left. Collapse та повторний виклик з тим самим значенням ідемпотентні щодо anchor.
- При above тримати ту саму bar-coordinate після змін root/body/picker/font/features; reflow observer або еквівалентний layout pass коригує root, а не anchor. Врахувати обидві межі border-box. Жодних hardcoded «відняти 26 px» чи нескінченного RAF/ResizeObserver loop.
- `ColorControl._resize()` не ресайзить вже змонтований picker за нульовим/прихованим slot. Fallback 200 допустимий для першого створення, не для кожного collapse. Зберігати last non-zero width; після появи layout актуалізується. Саме це прибирає зайву зміну висоти, але anchor-правило все одно обов’язкове для інших reflows.
- При hidden root не записувати clamp із width=0 як користувацьке положення. Після `empty → draw-min/draw-full` дочекатися реальної геометрії і виконати initial placement; наступний Tools hide/show повертає останню валідну позицію у межах поточного viewport.
- Обчислювати напрямок незалежно від collapsed: нижня половина доступної області → expand above, верхня → below; за браку місця пріоритет реального доступного простору. Те саме рішення читає chevron.
- Розширена body обмежена доступною висотою зі scroll, не витісняє bar за екран. Фактично видимий grip з touch target — всередині viewport; поточний «56 px будь-якої частини root» не гарантує доступності grip у центрі bar.
- Desktop дозволений deliberate partial offscreen drag не скасовується глобально. Initial layout і звичайна mobile позиція мають містити панель у safe bounds; після drag щонайменше весь grip і необхідні disclosure controls досяжні.
- `visualViewport` resize/offset/scroll і window resize не змішують різні системи координат. Нульовий resize, повторне відкриття, зміна features і поворот перевіряються окремо. Destroy від’єднує нові observers/listeners.

### 4.4 SVG grip + chevron через псевдоелемент

Main grip — семантична `button type=button` (або еквівалентно повністю доступний control), власний локальний SVG grip (наприклад 2×3 circles, `viewBox="0 0 24 24"`, currentColor, aria-hidden). Прибрати span/box-shadow dots, не тягнути icon font/network бібліотеку. Авторський SVG позначити як project-authored у відповідному provenance списку; якщо взяти SVGRepo — записати точний URL та ліцензію, не вважати весь каталог автоматично public-domain.

Chevron додається саме `#panel-grip::after` (CSS border/mask, декоративний, не окремий tab-stop). Спільний data-атрибут effective direction керує layout і псевдоелементом:

- collapsed + expand above → `⌃`;
- collapsed + expand below → `⌄`;
- expanded body above → `⌄` (згорнути до bar);
- expanded body below → `⌃`.

Collapsed стан має знати напрямок **до** першого відкриття. Після drag через середину/resize стрілка оновлюється без toggle. Accessible label явно каже «Розгорнути/Згорнути інструменти; перетягнути для переміщення» мовою чинного UI, `aria-expanded`, `aria-controls=panel-body`, Enter/Space, focus-visible. Drag понад threshold не викликає collapse, звичайний tap — один toggle, native button click не дублює pointerup toggle. `pointercancel`, lost capture і non-primary pointer не трактуються як tap. Extension disclosure не регресує.

### 4.5 Нижній anchor та іконка повернення — уточнення власника

На новому скриншоті `img_a0f6c7722acf.jpeg` native panel стоїть унизу, а праворуч унизу показано бажану return/back affordance. Зображення визначає розташування, не є доказом уже реалізованої дії.

- У embedded Play/Rescript default — native bar біля нижнього safe edge, body угору. Це не «трохи нижче wrapper». Iframe/canvas весь час full screen.
- Окрема SVG-кнопка «Показати інструменти / Повернути панель» залишається досяжною біля нижнього правого safe edge, коли native UI приховано/прибрано. Вона повертає панель у видиму нижню позицію, не виконує Undo, не повертає сцену назад і не змінює zoom/paint. Не ховати цей recovery control разом із root, який він відновлює; hit-area ≥44×44, aria-label, keyboard/focus-visible.
- Chevron grip лишається disclosure expanded/collapsed; return control — відновлення доступності панелі. Не плутати його з Close Fluid mode або додатковими State/Player tools. Узгодити видимість із host Tools, щоб один control не показував приховане іншим без оновлення стану.
- Збереження доступної user drag-position допустиме; явна команда повернення завжди має відновити нижній safe anchor. Верхній host wrapper не є цільовим anchor.

### 4.6 Multi-touch: скасування поточного touch-мазка та блокування до all-up

**Вимога власника:** при появі другого одночасного touch скасувати відбиток/поточний мазок першого пальця й заблокувати малювання до релізу всіх пальців. Йдеться про два одночасні контакти для zoom, не про послідовний double-tap.

**Підтверджено читанням коду, без нового runtime-repro:** `paint.js:1631–1698` починає manual stroke на panstart і відразу депонує contact; `pointer-dispatcher.js:165–168` при 1→2 викликає звичайний panend; `paint.js:1867–1885` flush/endStroke зберігає результат, а не відкочує. Перевірка `pointers.size !== 1` у `_syncBrushToPointer` не видаляє вже нанесений слід. Це source-діагноз за повідомленим дефектом, не вже перевірений fix.

- Негайна promotion 1→2 touch переводить contact-session у navigation-only latch. Зупинити deposition і скасувати поточний single-touch transaction **до звичайного stroke commit**, прибрати контактний відбиток та продовження цього поточного мазка, зберігши всі попередні завершені мазки.
- Скасування не є користувацьким Undo: не створює зайвих history/redo кроків, не відкочує попередню роботу, не лишає скасований мазок у session recording/export. Звірити snapshot/engine/recorder semantics до вибору механізму. Наявний `saveSnapshot()` сам змінює history та пише recording command, тому сліпий `undo()` не є достатнім рішенням.
- Після 2→1 touch залишковий палець **не** починає і не продовжує малювання. Заборона діє до active touch count=0; новий 0→1 дозволяє новий мазок. Врахувати 2→3→2→1→0, pointercancel/lost capture і вихід за canvas без завислого блокування.
- Pinch/pan змінюють view, не розмір painting rectangle; навігація працює навіть якщо обидва пальці майже не рухалися. Pending/coalesced events і async `yieldToManualInput()` не можуть запізніло воскресити скасований stroke: потрібна перевірка актуальності gesture/session після await.
- Mouse/pen та попередні завершені strokes не зачіпати. Не маскувати проблему затримкою всіх звичайних мазків чи вимкненням touch drawing.
- Механізм rollback може вимагати локального app/engine snapshot API; зберегти renderer/physics semantics. Будь-який новий engine helper обмежений transaction cancel, не загальним engine redesign.

### 4.7 Resize canvas тільки після hold

**Вимога власника:** resize не починається випадковим торканням краю. Спочатку hold, лише після його активації — видимий двонапрямний resize indicator і редагування розміру.

**Підтверджено кодом:** `paint.js:1679–1683` одразу входить у RESIZING; `onGesturePan` одразу викликає `_resizePaintingTo`; cursor logic `paint.js:1039–1054` показує resize за edge hit-test ще до hold. `PointerDispatcher` уже має `holdDelay:500` і `holdMoveTolerance:8` та hold lifecycle; paint bindings `:593–600` hold не підключають. Використати наявний recognizer, не додавати паралельний таймер без потреби.

- State flow: `idle → resize-pending → resize-active → commit/cancel`. У pending жодного resize preview, розмірової мутації чи resize-undo snapshot; немає активної ↔ affordance. Edge candidate не має непомітно депонувати фарбу.
- Використати чинні 500 ms / 8 px як початкові параметри, а не оголошувати нове фізично перевірене UX-значення. Tolerance має бути в CSS px незалежно від DPR/zoom. Mouse/pen edge resize також проходить hold: вимога не обмежена лише touch.
- Після успішного hold зафіксувати edge/corner і starting rectangle, показати ↔ (для вертикалі/кутів відповідну орієнтацію) як **видимий touch overlay**, не тільки CSS cursor. Лише наступний drag редагує resize preview без стрибка від накопиченого pre-hold delta.
- Up до hold або movement понад tolerance до активації скасовує pending без зміни розміру/history. Додавання другого пальця скасовує pending/active resize й передає жест pinch/pan; all-up drawing latch діє за §4.6. Pointercancel/lost capture/Escape скасовують preview, таймер та indicator.
- Нормальний release після activated resize commit один раз і створює один осмислений undo-крок; hold без зміни розміру — без порожнього кроку. Indicator зникає після завершення/скасування. Захистити асинхронний hold callback від старої contact-session.

## 5. Критерії приймання (MU-1: локальний eval PASS, human review очікується)

### Native — MU-1

1. При нижньому і верхньому anchor 20 settled collapse/expand циклів: `max(abs(bar.top-anchor.top)) ≤ 1 CSS px`, окремо collapsed та expanded, без накопичення. Зберегти також synchronous negative-control: він не замінює settled probe.
2. Після collapse picker не переходить на fallback через width=0; при rotate/visible width change отримує актуальний width.
3. Empty→preset і 10 Tools hide/show: initial root не з’являється на x=56 через приховане вимірювання; grip досяжний, normal mobile root у safe bounds.
4. Resize/reflow/fonts/features не зміщують user anchor без необхідності clamp; короткий viewport дозволяє дістатися всіх body actions скролом.
5. SVG є в DOM, старі dots spans/shadows прибрано; chevron усіх чотирьох станів і після drag; keyboard/tap/drag/cancel не дублюють actions.

### Wrapper — MU-2

6. Viewports 320×568, 360×800, 390×844, 412×915, touch landscape 844×390 та desktop 1280×800. Для кожного обидва режими: mobile primary 1 row, до **56 CSS px без safe-area inset**, control hit targets ≥44×44, немає horizontal overflow, Close завжди видимий.
7. More/колір/розмір відкривають лише запитану вторинну поверхню, доступні з keyboard/touch; Save/speed/thickness/палітра/clear/Tools не зникли. Error text читається без DevTools.
8. Iframe лишається full screen: його bounds і painting rectangle не змінюються через host panel/tray. Native bar початково стоїть у самому низу viewport, body відкривається вгору; native та host visible bounds не перетинаються. Є досяжна іконка повернення прихованої панелі. Host не перехоплює native grip/picker натискання. Перевірити entry, Tools, drag обох панелей, collapse/expand, tray, rotate та loading/error.
9. Desktop controls/drag і сторонні fire/hammer overlay, Close legacy та keyboard лишилися чинними.

### Зв’язка — MU-3

10. Справжній draw→Play autoplay→pause/restart→Tools→native drag/collapse→Save, плюс Rescript PNG→колір/size→stroke→clear→Save. No iframe reload, сцена не скидається при tray/rotate, PNG декодується і містить очікуваний результат.
11. У момент ready/transfer/repeated entry не виникають layout-driven scene failures; перевірити поворот до і після ready та reopen обох режимів.
12. Відомий 26 px/cycle дефект не відтворюється через реальні grip-click з очікуванням observer settlement. Візуальні screenshots до/після, source revisions та command results збережені.
13. Окремо physical Android Galaxy A56 і iPhone/Safari — human QA. Chromium емуляція не закриває це покриття; якщо пристрою немає, явно залишити debt, не оголошувати PASS.

### Жести — MU-2G (ще не виконано)

14. Другий touch після first-down без руху, після короткого мазка та після кількох simulation frames: скасований мазок відсутній у матеріалі/експорті, попередні strokes цілі. Порівняння GPU/material робити з контрольованим clock або paired baseline, щоб природна fluid evolution не маскувала/імітувала rollback.
15. У 2→1 та 3→2→1 рух залишкового пальця не малює; після 0→1 новий мазок працює. Cancel/capture-loss та queued/async events не залишають ghost strokes або permanent lock.
16. Quick edge tap/drag, up до hold та другий touch до hold не змінюють canvas size/history. Hold показує touch-visible ↔, наступний drag редагує, normal release commit один раз; cancel відновлює rectangle.
17. Повторити з різними DPR/zoom, portrait/landscape, mouse/pen та на фізичному телефоні. Source audit не є runtime/GPU PASS. Запис/replay не відтворює скасований touch stroke.

## 6. Межі та порядок

- MU-1: Fluid Paint native state/layout/disclosure і нижній anchor/повернення; MU-2: Tilecraft responsive wrapper; MU-2G: Fluid touch arbitration, rollback та hold-resize; MU-3: зв’язка обох боків і ручний mobile review. Повні handoff deliverables/команди — у канонічному HANDOFF.
- Не змінювати physics/color semantics/player MAX scheduler, історичний render/CPU debt теми fluid чи експортні імена. Дозволені лише необхідні для §4.6 transaction-cancel/snapshot/recording seams без загального redesign engine/recording. Layout-передавання bounds обмежене §4.2; загальний transport redesign поза scope.
- Новий mock harness замість живого UI не потрібен. Наявна `.pw-probe/layout-audit.mjs` корисна як приклад mobile geometry, але **не перелічує Fluid wrappers**. `tests/fluid-paint.pw.spec.js` перевіряє transport fixtures, а не реальну мобільну панель. Розширити існуючі focused UI tests і зареєструвати bounded pair probe лише для відсутнього покриття.
- У майбутній фазі виконати focused checks, її browser probe, внести факти/точні qa:* кроки в QA; закриття лише після owner review. Не запускати всю three suite/guard: ці файли поза її scope; якщо scope зачепить three, тоді його правила окремо обов’язкові.
- На цій стадії прийнято лише джерела вимог; запропонована композиція primary/tray ще не є owner-approved реалізацією.

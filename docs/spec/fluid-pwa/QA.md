# QA: Fluid PWA

Фази 1–7 закрито; регресійні сценарії перенесено в [_archive/QA-phases-1-7.md](_archive/QA-phases-1-7.md) (2026-10-15); [парний handoff](_archive/HANDOFF-phases-1-7.md).
Контракт 7A та сценарії safety/UX, потрібні для її приймання, лишено нижче. Фаза 7 прийнята із боргом, не новим UX/physical/CDN PASS. Метрики, URL і PID у збережених блоках — історичні; retained stand зараз не перевіряли.

## Збереження review stand

Не запускати build/guards/probes, що переписують shared `dist`, поки він обслуговує retained stand власника. Нижчі команди — інструкції, не дозвіл зупиняти retained server; для нового eval потрібен isolated source/output або окреме рішення власника.

## Локальний запуск

Фаза 1 **прийнята власником** 2026-10-14 (`handoff:next`), закрита.
Production deploy не виконано; сценарії лишаються регресійними.
**Фаза 2 прийнята власником 2026-10-14 (`handoff:next`) і закрита.** Naming migration
авторизована «Починай фазу 2», незалежний external-consumer audit не заявляється.
Команди для Windows Git Bash, з кореня `D:/work/fluid-paint/fluid-paint`:

```sh
npm run build
npm run test:pwa-assets
NODE_ENV=production node --test debug/pwa-release-test.js
PORT=3000 NODE_ENV=production node node_modules/gulp/bin/gulp.js startServer
```

Відкрити `http://127.0.0.1:3000/`. Сервер віддає саме зібраний `dist`, без
перезбирання. Інтернет потрібний лише для першого встановлення npm-залежностей;
fonts/icons/shell локальні. Demo — окремий зовнішній каталог, не offline shell.
Після перевірки зупинити свій сервер **Ctrl+C**. Не зупиняти чужий процес;
якщо порт зайнятий, спочатку визначити власника.

Автоматична проба (ручний сервер має бути зупинений):

```sh
PWA_QA_PORT=3000 npm run test:pwa-assets:browser
PWA_QA_PORT=3000 npm run test:pwa-release:browser
```

Вона сама піднімає й зупиняє gulp server, перевіряє звільнення порту, записує
`result.json`, HAR, trace, server log і шість PNG **поза repo** в унікальний
каталог `%LOCALAPPDATA%/Temp/fluid-pwa/phase1-…`. Без `PWA_QA_PORT` бере вільний
динамічний порт. На цьому checkout Playwright/Chromium вже доступні.
Phase-2 runner сам робить два production builds; evidence — автоматичний unique
`phase2-…`. Не запускати guards/probes паралельно із сервером (працюють з dist).

## Фаза 7A — запланований обов’язковий UX follow-up (не реалізовано)

Наступний дозволений крок — лише окреме `start 7A`; повний контракт/checklist
у [HANDOFF: НЕЗАКРИТЕ, 7A](./HANDOFF.md). До acceptance 7A фаза 8 заблокована.
Це план приймання, **не виконані нові QA-сценарії та не UX PASS**:

- [ ] Compact icon-first PWA status/actions; мінімум видимого тексту; повні IDs
  і технічні подробиці лише у secondary disclosure, не основній панелі.
- [ ] English default; reuse localization тільки якщо вона вже є. Якщо немає —
  не створювати localization framework/catalogs і не робити їх acceptance gate.
- [ ] Короткі English tooltips/accessible names, keyboard/focus/status semantics;
  desktop і 320px без blocking/overflow основних drawing/story controls.
- [ ] Короткий English loss warning залишається до reload/update: artwork/wet/Undo,
  PNG flattened; separate saved-file confirmation, explicit discard/cancel і всі
  active-work/multi-tab/once-only/embedded/install safeguards збережені.
- [ ] Перед review — real screenshots + icon/keyboard/consent/error/details probe
  та retained actual V1/V2 matrix, focused guards/build. Нові runnable scenarios
  назвати QA-7AUX-*; наявний QA-7A нижче — historical scenario фази 7.
- [ ] Окреме owner acceptance 7A до будь-якого `start 8`; no deploy permission.

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

## Фаза 7 — безпечна активація (прийнята й закрита із follow-up 7A)

**Прийнято власником через `handoff:next` 2026-10-15 із обов’язковим UX follow-up 7A.**
Closing commit поверх `5d900c1`; фази 1–7 прийняті. Preview/production deploy не виконано.
Далі — **окремий дозвіл на 7A**, не реалізація фази 8. 7A зараз лише контракт/checklist.
Фаза 8 заблокована до реалізації, eval і acceptance 7A та окремого дозволу. Контракт/source tracing/межі:
[PHASE7-REPORT.md](./PHASE7-REPORT.md). Нижчі phase-6 no-activation записи — історичні.

Запуск із кореня checkout (без іншого server/dist writer):

```sh
node debug/pwa-phase7-eval.js
# Лише нова production V1/V2 матриця:
node debug/pwa-activation-browser-test.js
```

Runner сам збирає, запускає й завершує свої servers/browsers. Evidence — новий
унікальний Temp поза repo. Для звичайного single-build ручного review придатні
команди преамбули: `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`.
Такий single build сам по собі **не** створює V1/V2 waiting: exact update matrix
виконує нова probe. Історичний eval stand автора завершено; поточний retained stand див. closing check. Інтернет не потрібний для
shell; зовнішні Demo/CORS не є acceptance цього eval. Production deploy заборонено.

Історичний final `$E` =
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase7-final-MsWR9J`;
`$R = $E/activation-browser`; historical actual `$U` =
`http://127.0.0.1:51333/?webgl=2&debug=none&diag=0&seed=41`.
`$U` — історичний URL з evidence, не живий стенд; поточна вільність порту не заявляється. Нижче browser
сценарії виконані actual probe; для human review відкрийте відповідні PNG і JSON.

Історичний runner PASS/exit 0: **22 commands exit 0**. Guard окремо passed/failed:
activation **12/0**, detection **15/0**, readiness **11/0**, worker **12/0**,
release **4/0**, assets **7/0**, harness **5/0**, shader **25/0**, demo **8/0**,
palette **6/0**; control API PASS без enumeration. Browser окремо: activation
**14/0**, detection **7/0**, readiness **13/0**, production **10/0**, assets
**2 viewport**, release **2 WebGL**, fixture **8 cases**. Не сумувати рівні/suites.
Попередні phase-1–6 числа нижче — історичні. Final all-suite logs — `$E/result.json`.

### QA-7A. Production factories та regression runner

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** `node debug/pwa-phase7-eval.js`.
**qa:inspect:** надрукований absolute evidence/result.json, окремі stdout/stderr.
**qa:expected:** PASS/exit 0, точні окремі counts вище. Actual production activation/worker/Paint implementations, не дубль алгоритму. Once-only marker тільки sessionStorage; no clients.claim, skipWaiting тільки verified ALLOW; unknown/missing safety, stale worker, storage refusal не активують. Повний make verify не заявляється.

### QA-7B. Unknown dirty і відмова користувача

**qa:mode:** browser
**qa:open:** `$U` із V1 active/V2 waiting; `$R/dirty-consent.png`.
**qa:action:** після реального мазка відкрити «Offline / встановлення» → «Оновити» → нижнє «Пізніше» (`#pwa-cancel`).
**qa:inspect:** текст consent про потенційно незбережений малюнок, мокру фарбу й Undo; identities у result.
**qa:expected:** production safety dirty=unknown, не clean; явна відмова лишає V1 active, V2 complete waiting і artwork. Жодного ALLOW/reload. Навіть порожній canvas не оголошується гарантовано saved.

### QA-7C. Мазок не обрізається

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/active-stroke-refused.png`.
**qa:action:** виконати QA-7A; знайти case held actual pointer stroke.
**qa:inspect:** strokeActive до/після відмови, drawn.magnitude і current release.
**qa:expected:** active=true; updater не викликає endStroke і не reload. Pointer up завершує справжній мазок, потім потрібний новий «Оновити». Проба навмисно DOM-click-ає update при утриманому real pointer: звичайний mouse click спочатку відпустив би його.

### QA-7D. Реальний export in-flight

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/export-in-flight-refused.png`.
**qa:action:** знайти actual export-in-flight case після QA-7A.
**qa:inspect:** real toBlob callback gate та production operation counter.
**qa:expected:** update відмовляє, поки encoder не завершився; V1 active/V2 waiting. Після відпускання callback справжній export Promise успішний. Це timing instrumentation реального browser encoder, не вигаданий Blob чи saved-file proof.

### QA-7E. PNG error не дає activation

**qa:mode:** browser
**qa:open:** `$U`, `$R/png-error-no-activation.png`.
**qa:action:** probe відкриває «Оновити» → «Завантажити PNG» з encoder callback null; після цього повертає оригінальний encoder.
**qa:inspect:** стійке «PNG export не вдався. Оновлення не застосовано.».
**qa:expected:** V1 active/V2 waiting, помилка не переходить у discard/ALLOW автоматично. Для нового рішення потрібний повторний «Оновити»; controls не залишаються inert після error.

### QA-7F. Окрема згода після справжнього PNG

**qa:mode:** browser
**qa:open:** `$U`; `$R/export-awaiting-separate-confirmation.png` та `$R/confirmed-artwork.png`.
**qa:action:** «Оновити» → «Завантажити PNG»; відкрити збережений файл; лише потім «PNG збережено — оновити все одно» (`#pwa-saved`).
**qa:inspect:** синій artwork 180×130, текст «Перевірте файл PNG на диску, потім окремо підтвердьте оновлення».
**qa:expected:** справжній download.failure=null, PNG 180×130 непорожній (у цьому final 17811 bytes); до другої кнопки V1 ще active. PNG — flattened image, не wet simulation/Undo checkpoint; API completion саме по собі нічого не активує.

### QA-7G. Import та Bake не перериваються

**qa:mode:** cli
**qa:open:** `$R/result.json`, actual Bake/local story loading cases.
**qa:action:** QA-7A; прочитати обидва відокремлені cases.
**qa:inspect:** Bake Promise на async yield boundary; full retained story import на File.text boundary.
**qa:expected:** кожна production operation блокує лише власну activation; після відмови реально завершується. Story успішно імпортована, V1 identity незмінна. Це real API з контрольованим timing, не просто присвоєння busy=true. Retained regression додатково виконує UI Bake та PNG import без цих gates.

### QA-7H. Playback не зупиняється updater-ом

**qa:mode:** browser
**qa:open:** `$U`; `$R/playback-refused.png`.
**qa:action:** probe викликає actual production `controller.play()` → DOM «Оновити»; після перевірки QA явно викликає `stop()` та `keepResult()`, тоді повторює «Оновити».
**qa:inspect:** Player state=playing під час відмови; paused також вважається active (production API guard).
**qa:expected:** updater не pause/stop/restart playback; reload немає. QA потім явно зупиняє story. Full large-story completion цим сценарієм не приймається.

### QA-7I. Інші вкладки — notification, не lock

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/export-awaiting-separate-confirmation.png`.
**qa:action:** знайти uncontrolled bootstrap та nonconsenting вкладки, activationWhileFrozen.
**qa:inspect:** UI «Відкрито ще 2 вкладок (включно з uncontrolled)»; source worker matchAll includeUncontrolled; BroadcastChannel note.
**qa:expected:** count включає same-scope uncontrolled. Actual nonconsenting tab frozen через CDP; V2 active/verified записано при otherStillFrozen=true **до resume**. «Оновити все одно» доступне після власного work gate; жодних client replies/quorum. Це desktop Chromium freeze, не physical suspended mobile acceptance.

### QA-7J. Нова вкладка у applying window

**qa:mode:** browser
**qa:open:** `$U&openedDuringApply=1`; `$R/new-tab-during-apply-old-shell.png`.
**qa:action:** probe тримає лише доставку genuine ALLOW message, відкриває нову вкладку pinned V1, потім відпускає повідомлення.
**qa:inspect:** V1 title/loaded document marker; result compat та cache-snapshot.json.
**qa:expected:** нова вкладка не втрачає V1 документ після V2 activation; offline old-hash JS fetch через новий SW має HTTP200/exact V1 SHA. Обидва complete inventories SHA-exact. Це детермінований pre-ALLOW applying race, не твердження про довільне timing браузера; cap/cleanup не реалізовано.

### QA-7K. Один reload лише requesting tab

**qa:mode:** browser
**qa:open:** `$R/v2-requesting-tab-verified.png`, `$R/nonconsenting-old-tab-after-activation.png`, result.
**qa:action:** перевірити стан після QA-7F та після наступного очікування probe.
**qa:inspect:** requesting navigation count=1, verified loaded target; original document markers інших tabs; sessionStorage marker=null.
**qa:expected:** requesting tab title V2 Fluid Paint, releaseId `699be88cc7ab9d5df2604b71d15dc35e5cbe35aad5ed35d6c62ec37238139cb0`; nonconsenting/race tabs лишаються V1 без reload. Uncontrolled tab не claimed. Повторні events/очікування не створюють loop; mismatch має error без другого reload (guard).

### QA-7L. Явне оновлення без збереження

**qa:mode:** browser
**qa:open:** той самий origin у незалежному persistent discard-profile; `$R/explicit-discard-v2.png`.
**qa:action:** «Оновити» → прочитати втрату мокрої фарби/Undo → «Оновити без збереження — оновити все одно» (`#pwa-discard`).
**qa:inspect:** verified V2 після actual DOM consent, без PNG API.
**qa:expected:** explicit discard є окремою дією, не автоматичним fallback після помилки. Target loaded shell/release verified, no loop. Жодна інша вкладка не перезавантажується цим рішенням.

### QA-7M. Persistent cold start та natural activation regression

**qa:mode:** cli
**qa:open:** `$R/persistent-cold-v2.png`, `$R/result.json`; `$E/production-regression/result.json`.
**qa:action:** QA-7A; прочитати context closures, cold-v2 і retained natural activation cases.
**qa:inspect:** той самий profile після повного browser close; offlineBeforeNavigation, fromServiceWorker; natural activation без ALLOW після закриття всіх clients.
**qa:expected:** cold V2 працює offline, artwork/wet/history автоматично не відновлюються. Retained production suite 10/0 з WebGL1/2/Bake/PNG/import/bounded completed playback/failed installs/embedded security/natural activation. Це не OS reboot, physical standalone чи full великої story completion.

### Незалежна parent-перевірка після handback

Повторні focused guards: activation **12/0**, worker **12/0**; `git diff --check` PASS.
Readback перевірив 22 command codes, suite/probe counts, 118 media artifacts,
cache inventories та відповідність production sources frozen evidence.
Повний повтор `verify-evidence.js` **FAIL на cleanup bind-back**, не browser case:
порт 51333 тепер зайнятий стороннім `DDPM.Subagent.User.exe` (PID 43012),
Node отримав EACCES. Exact process/network readback не знайшов phase-7
node/Chromium leftovers; сторонній процес не зупиняли. Попередній bind-back
усіх 45 портів є історичним PASS, не поточним твердженням про вільність.
`post-document-verification.json` тепер містить цей незалежний FAIL;
первинний final `result.json` і browser PASS незмінні. Consent PNG незалежно
переглянуто: окреме підтвердження збереження читабельне, artwork непорожній.

### Межі фази 7 / cleanup

Історично own browsers disconnected, eval servers stopped; final ports
57245/61163/61694/61152/53415/59252/59027/51333 тоді незалежно bind-back PASS.
Root result містить exact command. Первинний post-document verifier перевірив 45 own ports і 118 media artifacts; його PASS історичний. Поточний verifier FAIL на сторонньому 51333 описано вище, не browser FAIL. Retained review stand на 3000 збережено за вимогою власника (closing check). Чужих процесів не чіпали. Фази 8–10 не
реалізовано; cap/cleanup/rollback/offline demos не додані. Physical Android/iOS,
Safari/A2HS/standalone/native GPU/OS reboot, real mobile suspension/native install
dialog, quota/eviction/browser MIME/hash injection, full large-story playback,
live CDN/Netlify headers/CORS/demo downloads та full make verify — **NOT TESTED**.
Попередні помилки, instrumentation та source tracing — report; невдалі спроби
не є acceptance. Наступний крок — **окремий дозвіл на 7A**, не phase-8 implementation.

### QA-6F. Mobile width та повні identities

**qa:mode:** browser
**qa:open:** друга вкладка QA-6E, viewport 320×900; `$R/320-waiting.png`.
**qa:action:** залишити summary відкритим після QA-6E, змінити viewport на 320×900.
**qa:inspect:** обидва довгі releaseId та bounds панелі.
**qa:expected:** x=12, width=296, horizontal overflow=false; IDs переносяться, обидві кнопки доступні, вертикальний internal scroll дозволений. Warning видимий і collapsed. Це Chromium viewport, не фізичний телефон; expanded disclosure можна згорнути перед drawing.

### QA-5G. 320px, клавіатура і видиме попередження

**qa:mode:** browser
**qa:open:** local URL після QA-5C, viewport 320×900; `$R/320-ready.png`, `320-warning-collapsed.png`.
**qa:action:** focus summary «Offline / встановлення»; Enter згортає/розгортає; перевірити desktop 1000×720. Для State/Bake — retained production probe без force clicks.
**qa:inspect:** disclosure bounds і текст; коротке жовте попередження у згорнутому стані; основні controls згори.
**qa:expected:** x=12, ширина 296px на 320px, без horizontal overflow; текст читабельний; native keyboard працює, focus видимий, warning не зникає при згортанні. Панель знизу не перехоплює State tab. Це viewport Chromium, не телефон. Embedded `?embedded=1`/iframe не отримує PWA overlay.

## Межі й не перевірене

- Історично фаза 2 додала inventory без CacheStorage; фаза 3 — лише fixture.
  Фаза 4 тепер реалізує production SW/app offline cold start, див. QA-4/report.
  Фаза 5 прийнята: readiness/install UX (див. QA-5);
  фаза 6 прийнята: detection/Later та hosting header definitions.
  Safe activation/reload прийнято у фазі 7 із обов’язковим UX follow-up 7A перед 8; live Netlify/CDN/deployment acceptance ще не виконані.
  Фаза 1 не додавала hashing (історичний факт); no-SW expectations фаз 1–3
  superseded фазою 4, fixture byte-preservation guard збережено.
- Android/iOS standalone та фізичні пристрої — NOT TESTED, майбутні фази.
  Production cold start підтверджено тільки desktop Chromium/SwiftShader.
  Ширина 320px — desktop Chromium viewport, не телефон.
- Відкриття + ініціює чинний запит Demo index до CDN (2 запити у пробі).
  Це optional app data, не HTML/CSS/manifest dependency; CORS/demo playback
  та доступність зовнішнього каталогу не приймаються цією фазою.
- На mobile story panel накладається на основну й має прозорий фон; це чинний
  layout. Geometry і fonts перевірено, новий UX тут не реалізовано.
- Зовнішні footer anchors прибрані задля буквального guard «0 cross-origin
  HTML links»; attribution-текст незмінний, URLs збережені в assets/PROVENANCE.md.
- Icon master owner-directed; нової ліцензії на чужий арт не вигадано.

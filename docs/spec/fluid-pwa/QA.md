# QA: Fluid PWA

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

## Фаза 6 — headers / detection (прийнята й закрита)

**Прийнято власником через `handoff:next` 2026-10-15; фазу 6 закрито.**
Фази 1–6 прийняті; closing commit поверх `5d876c7`, deploy не виконано.
Далі фаза 7 після окремого дозволу. [PHASE6-REPORT.md](./PHASE6-REPORT.md).
Преамбулу перевірено: рядка `**Деплой:**` немає; production prohibition має пріоритет.

Запуск із кореня checkout: `node debug/pwa-phase6-eval.js`. Runner сам робить
послідовні builds/guards/probes, закриває own browsers/servers та пише evidence
у новий external Temp. Не запускати паралельно з іншими dist writers.
Для ручного single-build review придатні команди преамбули; exact V1/V2/404
матрицю відтворює runner, не звичайний Gulp server. Stand автора зупинений.

Свіжий evidence `$E` =
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase6-final-Bxucp5`;
`$R = $E/detection-browser`, historical actual URL `$U` =
`http://127.0.0.1:56608/?webgl=2&debug=none&diag=0&seed=41`.
Цей порт тепер звільнений; screenshots/result — стійкий review artifact.
Root result: **20 top-level commands exit 0**, runner PASS/exit 0.
Guard suites: detection **15/0**, readiness **11/0**, worker **10/0**, release
**4/0**, assets **7/0**, harness **5/0**, shader **25/0**, demo **8/0**, palette
**6/0**; control API PASS. Browser: detection **7/0**, readiness **13/0**,
production **10/0**, assets **2 viewport**, release **2 WebGL**, fixture **8 cases**.
Різні suites/рівні не сумувати. Усі нові кроки виконано actual probe до review.


Closing check 2026-10-15: production build PASS; свіжі окремі guards detection
**15/0**, readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**,
harness **5/0**. Збережені browser results повторно прочитано без перезапуску:
detection **7 cases**, readiness **13 cases**, production **10 cases**, assets
**2 viewport**, release **2 WebGL**, fixture **8 cases** — історичні PASS.
Evidence readback PASS до closure edits: 20 command codes, 99 media artifacts,
всі final/scratch порти bind-back PASS. Всі NOT TESTED межі збережено.

### QA-6A. Headers та scheduler guards

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** `node debug/pwa-phase6-eval.js` (ручні servers перед цим зупинити).
**qa:inspect:** root result, detection.stdout.log, netlify.toml та generated dist/_headers.
**qa:expected:** PASS/exit 0; окремі counts вище. no-store для SW/двох metadata, no-cache для HTML; immutable лише exact full-SHA inventory paths, не fixed names. Startup/foreground/online/manual/timer, throttle 60000ms, coalescing, hidden stop, completion timer rearm, stale/duplicate/failed worker guards PASS. 15 хвилин перевірено injected clock, не wall-clock device QA. Local HTTP readback не є live Netlify acceptance.

### QA-6B. Active V1 / identity UI

**qa:mode:** browser
**qa:open:** `$U` після fresh online install та explicit QA reload; `$R/v1-ready.png`.
**qa:action:** натиснути summary «Offline / встановлення» внизу ліворуч.
**qa:inspect:** offline status, active identity, last-check time/result; `$R/result.json` identities.
**qa:expected:** pinned V1 ready, повний 64-hex active releaseId; updateViaCache=none. Час не «ще не було». Progress під час checking/downloading indeterminate, без byte/% claims; у стійкому стані hidden. Registration сама по собі ready не дає (retained readiness probe).

### QA-6C. Failed required JS install

**qa:mode:** cli
**qa:open:** `$R/result.json`, `$R/server.json`, `$R/failed-install.png`.
**qa:action:** виконати runner QA-6A та знайти case actual required JS 404 redundant install.
**qa:inspect:** failed UI, waiting=null, actual active STATUS та 404 server entry.
**qa:expected:** «Не вдалося перевірити / підготувати оновлення», не «Оновлення готове»; V1 активна. Це actual production SW/404, не лише mock. Retained production probe додатково покриває network cut і cold offline V1 після failed upgrades.

### QA-6D. V2 waiting та «Пізніше»

**qa:mode:** browser
**qa:open:** та сама `$U`, server тепер віддає frozen V2; `$R/v2-waiting.png`, `$R/later-v1.png`.
**qa:action:** натиснути «Перевірити оновлення», дочекатися «Оновлення готове», натиснути «Пізніше».
**qa:inspect:** active/waiting identities та стійкий статус.
**qa:expected:** active V1 `32c318ca80267327a6faa8b679730b046d44b26883166583636ddd7075c35b77`, waiting complete V2 `329d9fdc34cd3fbe0c2b4a5ce775bb5464da2d06d86a01fc6a354f09d2bb3d46`; після click «Оновлення відкладено». V1 URL/title не reload, V2 installed/waiting. «Оновити»/activation навмисно ще немає — фаза 7.

### QA-6E. Waiting існує до UI bootstrap

**qa:mode:** browser
**qa:open:** `$U&existingWaiting=1` у другій вкладці при відкритій V1; `$R/existing-waiting-bootstrap.png`.
**qa:action:** відкрити другу вкладку й summary, не робити ручного update.
**qa:inspect:** active/waiting IDs і title; fromServiceWorker у result.
**qa:expected:** старий pinned V1 HTML, title Fluid Paint; V2 already-waiting виявлено без нового updatefound. Actual SW response, не bootstrap mock. Повторні events не скидають Later для тієї самої identity (guard).

### QA-6F. Mobile width та повні identities

**qa:mode:** browser
**qa:open:** друга вкладка QA-6E, viewport 320×900; `$R/320-waiting.png`.
**qa:action:** залишити summary відкритим після QA-6E, змінити viewport на 320×900.
**qa:inspect:** обидва довгі releaseId та bounds панелі.
**qa:expected:** x=12, width=296, horizontal overflow=false; IDs переносяться, обидві кнопки доступні, вертикальний internal scroll дозволений. Warning видимий і collapsed. Це Chromium viewport, не фізичний телефон; expanded disclosure можна згорнути перед drawing.

### QA-6G. Offline check не означає no-update

**qa:mode:** browser
**qa:open:** перша `$U` після «Пізніше»; `$R/offline-check-failed.png`.
**qa:action:** вимкнути мережу контексту, натиснути «Перевірити оновлення».
**qa:inspect:** last-check result та actual waiting STATUS у result.
**qa:expected:** failed і «Це не означає, що оновлень немає», не no-update. V2 complete waiting збережено. Chromium може resolve update() з existing candidate offline; все одно робимо attempt, але не називаємо його online success. Late STATUS не стирає failed (guard).

### QA-6H. Later лишає V1 працездатною, без mixed assets

**qa:mode:** browser
**qa:open:** та сама offline `$U`; `$R/later-v1-drawing.png`, `$R/later-v1-export.png`.
**qa:action:** згорнути PWA disclosure, підготувати полотно recipe QA-2B, провести pointer stroke; panel grip → Save As… .
**qa:inspect:** синій artwork, actual PNG та cache-snapshot/result loaded scripts.
**qa:expected:** drawn.magnitude>0, GL error=0, download.failure=null, PNG 180×130; active V1 / waiting V2 незмінні. Scripts лише з V1 inventory, обидва complete cache inventories SHA-exact, no reload/title/URL change. Retained production/regression окремо виконує WebGL1/2 resize/Bake/import/story subset playback і embedded security без force clicks.

### Межі фази 6 та cleanup

Physical Android/iOS/Safari/A2HS/standalone, native GPU/OS reboot, 15-minute
wall-clock/suspended lifecycle, native install dialog, browser quota/eviction/
MIME/hash faults, full large-story completed playback, live Netlify/CDN headers,
CORS/demo downloads, full make verify — NOT TESTED. Safe activation/reload,
retention/cap/rollback та offline demos не реалізовано. Own browsers disconnected,
servers stopped; final ports 61749/52260/54432/49202/59812/64177/56608 окремим
process bind-back PASS. Root command/log містить exact bind command. Чужих
процесів не зупиняли, review stand не залишено. Phase6 прийнята й закрита.

## Фаза 5 — readiness / install UX (прийнята, закрита)

**Прийнято власником через `handoff:next` 2026-10-15, закрито.**
Closing commit поверх `feba360`; deploy не виконано. [PHASE5-REPORT.md](./PHASE5-REPORT.md) — контракт, source tracing,
історичний eval реалізації і межі. Нові сценарії виконані автором; NOT TESTED збережено.

З кореня checkout: `node debug/pwa-phase5-eval.js`. Прямі Node entrypoints,
послідовний shared-dist runner; ручний server перед запуском зупинити.
Для ручного review: `NODE_ENV=production node node_modules/gulp/bin/gulp.js build`,
потім `PORT=3000 NODE_ENV=production node node_modules/gulp/bin/gulp.js startServer`.
Відкрити `http://127.0.0.1:3000/?debug=none&diag=0`. Це localhost, не LAN-IP.
Перше встановлення shell online; optional demos/CORS не є частиною цієї фази.
Після review зупинити лише свій server і перевірити порт. Автор server не лишив.

`$E` нижче — **абсолютний**
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase5-final-bUqgxL`.
`$R = $E/readiness-browser`; real HAR/trace/profile/frozen dist та 9 PNG — там.
Root `result.json` містить exact commands/exit codes: 18 команд exit 0.
Guard readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**,
harness **5/0**, shader **25/0**, demo **8/0**, palette **6/0**; control API PASS.
Browser readiness **13/0**, production regression **10/0**, assets **2 viewport**,
release **2 WebGL**, fixture **8 cases**. Різні suites/рівні не сумувати.

### QA-5A. Guard та readiness identity

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** виконати `node debug/pwa-phase5-eval.js` без паралельних builds/probes.
**qa:inspect:** надрукований evidence root/result.json, окремі stdout/stderr logs.
**qa:expected:** status PASS, exit 0; counts вище; registration/uncontrolled/wipe, actual controller identity, wrong shell/version, stale requestId і bounded timeout відмовляють у false ready. Built HTML token реконструйовано та перевірено SHA-256. Standalone/iPad/fallback policy покрито guard, не physical QA.

### QA-5B. Fresh profile / лише registration

**qa:mode:** browser
**qa:open:** новий browser profile online → `http://127.0.0.1:3000/?debug=none&diag=0`; evidence `$R/first-uncontrolled.png`.
**qa:action:** відкрити «Offline / встановлення» внизу ліворуч; дочекатися online install, не reload.
**qa:inspect:** статус і пояснення у disclosure; у probe actual controller=null.
**qa:expected:** «Підготовка offline», текст «Ця сторінка ще не контролюється…», не «Готово…». Попередження про малюнок/wet/Undo вже видиме. Never-prepared profile offline взагалі не завантажує shell; не обіцяємо перший offline launch. Покрито actual persistent Chromium.

### QA-5C. Explicit reload → verified ready

**qa:mode:** browser
**qa:open:** та сама online вкладка після QA-5B; `$R/desktop-ready.png`.
**qa:action:** прочитати попередження, зберегти потрібну роботу; самостійно Reload; розгорнути disclosure.
**qa:inspect:** стійкий статус та pinned shell/controller/complete у `$R/result.json`.
**qa:expected:** «Готово до роботи offline», «Це не резервна копія малюнка». Actual controller=active activated, complete=true, shellId збігається із loaded HTML. Додатковий controlled diagnostic document із навмисне іншим shell token відхиляється (`mismatched-shell-refused.png`); не називається реальним release upgrade.

### QA-5D. Cold offline restart

**qa:mode:** cli
**qa:open:** `$R/result.json`, `cold-offline-ready.png`, `cold-offline.har`, `cold-offline-trace.zip`.
**qa:action:** перевірити case persistent browser closed/cold offline та closures.
**qa:inspect:** offlineBeforeNavigation, fromServiceWorker та status; усі browserDisconnected.
**qa:expected:** той самий profile після повного close, offline до першої navigation; SW response і verified ready. Малюнок/wet/history не відновлюються автоматично. Це не OS reboot і не physical standalone launch.

### QA-5E. Видалений CacheStorage

**qa:mode:** cli
**qa:open:** `$R/result.json`, `cache-wipe-unavailable.png`.
**qa:action:** знайти actual CacheStorage deletion/recheck та наступний cache-only wipe reload case.
**qa:inspect:** deleted cache names, unavailable, пояснення втрати підготовки та expected reload error.
**qa:expected:** ready відкликано: «Offline недоступний», «Локальна підготовка відсутня або втрачена». Причину очищення не вигадано. Після cache-only wipe reload worker fail-closed, shell недоступний; застосунок не обіцяє власний UI там, де HTML не завантажився. Покрито справжнім delete, не quota/eviction simulation.

### QA-5F. Повне site-data wipe + online reload

**qa:mode:** cli
**qa:open:** `$R/result.json`, `site-wipe-reloaded-uncontrolled.png`, `after-site-wipe.har`.
**qa:action:** знайти CDP Storage.clearDataForOrigin all, browser restart і online navigation, потім explicit user reload.
**qa:inspect:** новий controller=null/preparing; generic storage-loss disclosure; наступне ready.
**qa:expected:** перша online сторінка після wipe не ready, пояснює повторну online-підготовку, але не стверджує без surviving evidence «ми виявили видалення». Після нового install і user reload verified ready повертається. Повністю видалені дані самі не доводять минулу історію.

### QA-5G. 320px, клавіатура і видиме попередження

**qa:mode:** browser
**qa:open:** local URL після QA-5C, viewport 320×900; `$R/320-ready.png`, `320-warning-collapsed.png`.
**qa:action:** focus summary «Offline / встановлення»; Enter згортає/розгортає; перевірити desktop 1000×720. Для State/Bake — retained production probe без force clicks.
**qa:inspect:** disclosure bounds і текст; коротке жовте попередження у згорнутому стані; основні controls згори.
**qa:expected:** x=12, ширина 296px на 320px, без horizontal overflow; текст читабельний; native keyboard працює, focus видимий, warning не зникає при згортанні. Панель знизу не перехоплює State tab. Це viewport Chromium, не телефон. Embedded `?embedded=1`/iframe не отримує PWA overlay.

### QA-5H. Unsupported install fallback

**qa:mode:** browser
**qa:open:** local URL після QA-5C, Chromium без native install offer; `$R/desktop-ready.png`.
**qa:action:** розгорнути disclosure, читати нижній install текст; не створювати synthetic beforeinstallprompt.
**qa:inspect:** меню/tab fallback, відсутність фальшивої кнопки install.
**qa:expected:** коли genuine event немає, кнопка hidden; видно інструкцію меню / працювати у вкладці. У цьому eval nativePromptOffered=false: system dialog acceptance NOT TESTED. Якщо браузер справді надасть event, одноразова кнопка викличе його лише після user click; автоматичної установки немає.

### QA-5I. iOS UA preview — не real Safari

**qa:mode:** cli
**qa:open:** `$R/ios-ua-instructions.png`, `ios-preview.har`, `ios-preview-trace.zip`, `$R/result.json`.
**qa:action:** прочитати browser case iOS UA Chromium preview та відкрити real PNG.
**qa:inspect:** «На iPhone / iPad відкрийте у Safari: Поділитися → На початковий екран (Add to Home Screen)».
**qa:expected:** manual A2HS instruction, install button hidden, текст «Автоматичної установки немає». Це UA preview у Chromium, НЕ Safari/physical iOS і НЕ встановлений standalone app.

### NOT TESTED / межі фази 5

Physical Android/iOS/real Safari/A2HS/standalone, native GPU, OS reboot, browser
quota exhaustion/automatic eviction та browser MIME/hash faults, full large-story
completed playback, live CDN/headers/CORS/demo downloads, full `make verify` —
NOT TESTED. Guard standalone policy не є device acceptance. Retained Node fault
branches не є actual browser quota proof. Фази 6–10 не починались; немає update
activation/reload/cap/rollback machinery. Physics/palette/vendor/Netlify/prod
не змінено. Наступний крок — фаза 6 після окремого дозволу почати.

## Фаза 4 — production offline shell (прийнята, закрита)

**Прийнято власником через `handoff:next` 2026-10-15, закрито.**
Код/документи входять у closing commit поверх `66c65e1`; deploy не виконано. [PHASE4-REPORT.md](./PHASE4-REPORT.md) містить контракт, виміряні
факти та NOT TESTED. Преамбула запуску вище прочитана; рядка `**Деплой:**`
немає, production deploy окремо заборонено. Нові сценарії виконано автором;
Історичний eval нижче не перетворює NOT TESTED на PASS.

### Запуск / evidence

```sh
node debug/pwa-phase4-eval.js
# Вузький guard + production probe:
NODE_ENV=production node node_modules/gulp/bin/gulp.js build
node --test debug/pwa-worker-test.js
node debug/pwa-worker-browser-test.js
```

Runner створює унікальний Temp evidence root поза repo, сам запускає/закриває
servers та browsers. Не чистити збережений profile, щоб підмінити cold proof
fresh-profile запуском. Поточний successful evidence:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase4-final-5sYqN3/`.
Нижче `$E` означає цей **абсолютний** root; `$E/production-probe` має actual
production dist snapshots/profile, 5 HAR/5 traces, screenshots і PNG exports.
Історичні results реалізації 2026-10-14: worker 10/0; release 4/0; assets 7/0; harness 5/0; shader 25/0;
demo 8/0; palette 6/0; control API PASS. Production browser 10/0;
retained browsers: assets 2 viewport, release 2 WebGL, fixture harness 8 cases.
Різні рівні й suites не підсумовуються.

Для ручних кліків запустити свій production build/Gulp server за преамбулою
і відкрити `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`;
повторити з `webgl=1`. Для exact install-failure/security matrix використовувати
runner, не підмінювати його Gulp serving: no-store/MIME та network cuts дає
production-like harness. Gulp server не є live CDN headers acceptance.
Всі review servers автора зупинені; порт у збережених URLs — історичний,
не живий стенд. Власний ручний server після перевірки завершити Ctrl+C.

### QA-4A. Guards та production/source/dev boundary

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`.
**qa:action:** виконати `node debug/pwa-phase4-eval.js`.
**qa:inspect:** stdout, надрукований root/result.json і окремі `.stdout.log`/`.stderr.log`.
**qa:expected:** exit 0, status=PASS; counts вище; actual dev build не має sw.js/registration, production має identity-pinned SW; source HTML не вантажить registration. Покрито guard+actual build, не лише regex.

### QA-4B. Реальний complete precache

**qa:mode:** cli
**qa:open:** `$E/production-probe/result.json`, `v1-cache.json`, `online.png`.
**qa:action:** прочитати active та cache snapshot після online install/reload.
**qa:inspect:** releaseId/complete, SHA/size всіх inventory entries та last-written marker.
**qa:expected:** active.complete=true; один V1 cache, 19 assets+marker; hashes exact; усі HTTP readbacks 200/correct MIME. Registration success саме по собі ready не проголошує. Покрито actual SW, не fixture.

### QA-4C. Повне закриття і cold offline navigation

**qa:mode:** cli
**qa:open:** `$E/production-probe/result.json`, `cold-offline-trace.zip`, `final-cold.png`.
**qa:action:** перевірити case «all pages closed/browser restarted/offline before first navigation» і closures.
**qa:inspect:** fromServiceWorker, unchanged query URL, pagesClosed/browserDisconnected.
**qa:expected:** перше navigation після restart — SW HTTP response, не live toggle/reload proof; п'ять processes disconnected у повному runner. Offline cold navigation після failed upgrades теж працює. OS reboot не заявляється.

### QA-4D. Offline малювання

**qa:mode:** browser
**qa:open:** local URL вище після online install, ready/reload; увімкнути offline у DevTools. Для збереженої проби — `$E/production-probe/webgl2-draw.png` і `webgl1-draw.png`.
**qa:action:** виконати recipe QA-2B, провести pointer stroke по білому canvas; повторити WebGL1/2.
**qa:inspect:** непорожній синій мазок та drawn у production result.
**qa:expected:** materialMagnitude>0, glError=0, WebGL backend відповідний URL. Покрито actual pointer draw після cold offline launch.

### QA-4E. Offline resize

**qa:mode:** browser
**qa:open:** та сама offline вкладка після QA-4D; screenshots `webgl*-resize.png`.
**qa:action:** виконати block QA-2C; змінити viewport 960×720 → 1000×740.
**qa:inspect:** canvas і resized у result.
**qa:expected:** 196×142, previewError=commitError=0, мазок лишається. Existing debug preview/commit API + actual viewport resize, не edge-pointer acceptance.

### QA-4F. Offline Bake

**qa:mode:** browser
**qa:open:** та сама offline вкладка; `$E/production-probe/webgl*-bake.png` і `webgl*-baked-artwork.png`.
**qa:action:** grip → + → State → `#bake-button` за QA-2D.
**qa:inspect:** стійкий `#bake-status`, Undo/Redo, artwork після згортання panels.
**qa:expected:** «Baked. Wet paint and Undo history were reset.»; maxRenderedDelta=0, wet=0, background=true, Undo/Redo=false. Actual UI click, не mock.

### QA-4G. Offline PNG export

**qa:mode:** browser
**qa:open:** та сама вкладка після Bake; `$E/production-probe/webgl1-export.png`, `webgl2-export.png`.
**qa:action:** закрити extension, розгорнути panel, натиснути `#save-button`, зберегти download.
**qa:inspect:** downloaded PNG в image viewer.
**qa:expected:** справжній непорожній PNG 196×142 із синім artwork; download.failure=null. Flattened export, не wet checkpoint.

### QA-4H. Offline локальний PNG import

**qa:mode:** browser
**qa:open:** вкладка QA-4G; screenshot `webgl*-import.png`.
**qa:action:** + → File → `#story-file-input`, вибрати exported PNG.
**qa:inspect:** `#story-background-name` і canvas.
**qa:expected:** filename показано, hasBackground=true, source dimensions 196×142; жодного network download PNG. Actual file input, обидва backends.

### QA-4I. Offline import retained story

**qa:mode:** browser
**qa:open:** вкладка QA-4H; screenshot `webgl*-story.png`.
**qa:action:** File input → `docs/story-2026-09-08-4-frames.json` із checkout.
**qa:inspect:** Player filename і controller.state.
**qa:expected:** original filename і state=ready. Великий retained JSON імпортований offline; завершення всього його playback цим check не заявляється.

### QA-4J. Offline completed локальний playback

**qa:mode:** browser
**qa:open:** та сама вкладка; `$E/production-probe/local-story-12-tiles.json`.
**qa:action:** імпортувати цей bounded subset retained source через File input; вибрати `#story-speed` 16×; натиснути `#story-play-pause`.
**qa:inspect:** Player та `webgl*-playback.png`.
**qa:expected:** стійкі «Playback completed.», «14 / 14 operations · 100% painted»; completed, pendingOperations=0, glError=0. Обидва WebGL backends; реальна story pipeline, не SW fixture. Повна 1.9 MB story до кінця — NOT TESTED.

### QA-4K. Реальний network cut нового install

**qa:mode:** cli
**qa:open:** `$E/production-probe/result.json`, `server.json`, `browser.json`, `failed-network-old-offline.png`.
**qa:action:** знайти case actual failed upgrade network після V1 install.
**qa:inspect:** fetchedEntries/cut hits, redundant/waiting і exact old cache snapshot.
**qa:expected:** required JS TCP socket розірвано після інших fetches; worker redundant, waiting=false, old releaseId лишився, partial cache відсутній; V1 app offline відкривається. Не mock-only proof.

### QA-4L. Required asset 404

**qa:mode:** cli
**qa:open:** той самий production result; `failed-404-old-offline.png`.
**qa:action:** знайти case actual failed upgrade 404.
**qa:inspect:** asset pathname, real HTTP 404, redundant, V1 cache hashes.
**qa:expected:** required JS 404 відхиляє install; old app продовжує offline працювати, без HTML-as-JS fallback/partial serving. Guard окремо перевіряє MIME/HTML/hash/quota/format/status/network reasons.

### QA-4M. Routing allowlist і query

**qa:mode:** cli
**qa:open:** production result routingOffline та worker guard stdout.
**qa:action:** прочитати URL cold starts, failed fetches `/missing.js`, `/release.json`, `/sw.js`, shader path і allowlist test.
**qa:inspect:** unchanged location.search, network-only failures, cross-origin/POST/auth/range guard.
**qa:expected:** `/` і `/index.html` мають pinned HTML без переписаного query; інші paths не отримують HTML. Inventory only cache-first, без SWR.

### QA-4N. Embedded origin/window security regression

**qa:mode:** cli
**qa:open:** production result embedded case та `embedded-security.png`.
**qa:action:** прочитати controlled iframe state і actual wrong-origin attacker refusal.
**qa:inspect:** exact editorOrigin query, controller=true, embedded.ready=true, unchanged state після attack.
**qa:expected:** same-origin iframe реальний bridge handshake проходить; сторонній origin/window не доходить до ready за 600ms deadline. Vendored code незмінний; повний зовнішній Tilecraft scene/export flow цим handshake не приймається.

### QA-4O. Verified update waiting, лише natural activation

**qa:mode:** cli
**qa:open:** production result останніх двох cases; `valid-upgrade-waiting.png`, `natural-activation-cold.png`.
**qa:action:** прочитати active/waiting STATUS replies і наступний cold start.
**qa:inspect:** V1 active, V2 waiting.complete=true; URL unchanged; новий active після close.
**qa:expected:** valid V2 не активується примусово і не reload V1; після всіх clients close природно активується V2, title `v2 Fluid Paint`, offline fromServiceWorker=true. Update UX ще не реалізовано.

### QA-4P. Cleanup та окремий bind-back

**qa:mode:** cli
**qa:open:** root/result.json та `independent-bind-back.stdout.log`.
**qa:action:** прочитати exact separate-process bind command; за потреби виконати його з verifiedPorts result.
**qa:inspect:** closures, serverStopped/attackerStopped, portFree, всі owned regression ports.
**qa:expected:** всі browsers disconnected, own servers stopped, кожен owned port окремо bindable; review stand не залишено, чужі процеси не зачеплено. Профілі/artifacts збережені тільки в Temp.

### NOT TESTED / межі фази 4

Real browser MIME/HTML/hash injection та actual quota exhaustion — NOT TESTED
у браузері; rejection branches виконані exact-worker Node guards. Physical
Android/iOS/standalone/native GPU/OS reboot, storage eviction, full large-story
playback, live headers/CDN/CORS demos, retention/cap/rollback/multitab/update UX,
full `make verify` — NOT TESTED / майбутні фази. Offline restart не відновлює
wet drawing; readiness/install/warning UX — фаза 5+. Деталі в report.

## Фаза 3 — persistent SW harness (2026-10-14, прийнята)

**Прийнято власником через `handoff:next` 2026-10-14, закрито.** Deploy не виконано. Це викидна fixture, не production SW/app.
Усі QA-3A–3G покриті real Playwright eval; людина перевіряє читабельність
скриншотів і межі результату. [Компактний звіт](./PHASE3-REPORT.md).

### Запуск фази 3

Попередній ручний Gulp server має бути зупинений. Порт 3000 не займати чужим
процесом; якщо зайнятий, вибрати інший **однаковий для обох commands**.
Інтернет не потрібний за наявності Playwright/Chromium; це localhost secure
context. Evidence та profile — лише дочірні каталоги `os.tmpdir()`, не repo.
`--review` відкриває справжній headed Chromium і сам закриває його після тесту;
сервер не лишається для ручних кліків. Стала сторінка review — real PNG files.

З кореня repo, Git Bash, один термінал; `PWA_PHASE3` лишити в цьому shell:

```sh
PWA_PHASE3="$(node -e 'const fs=require("fs"),os=require("os"),path=require("path");console.log(fs.mkdtempSync(path.join(os.tmpdir(),"fluid-pwa-phase3-review-")))')"
npm run build
npm run test:pwa-sw -- --port 3000 --profile "$PWA_PHASE3/profile" --evidence "$PWA_PHASE3/guard-selftest"
npm run pwa:sw:review -- --port 3000 --profile "$PWA_PHASE3/profile" --evidence "$PWA_PHASE3/probe-resume-review" --resume
npm run test:pwa-assets
```

Перший command створює fixture v1, другий **окремий Node process** бачить її
v2/cache без registration і переходить до v3. Повторний review на цьому
профілі запускати тільки з `--resume` і новим `--evidence`; не видаляти кеші
для «зеленого» результату. `--resume` без валідного marker чи зі зміненим port
відхиляється. Default `npm run test:pwa-sw:browser` має власний новий profile
і dynamic port. Для швидкого selftest можна запускати без headed review.
Якщо shell npm wrapper не працює, exact Node entrypoint цього checkout:
`node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'` замість `npm`.
Саме через цей npm entrypoint виконано всі scripts у final eval.

Історичні окремі результати реалізації: build PASS; guards **5/0**, browser selftest **8/0**;
separate-process resume probe **8/0**; retained assets **7/0**. Не сумувати suites.
Chromium 153.0.8010.12, Node 24.19.0. Обидва server stop/bind-back PASS,
0 page errors; negative timeout 250ms фактично 260ms/266ms у final pair.

Evidence root поточного eval:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-final-JSzEQD/`.
Тут `result.json` із exact commands/exit codes та stdout/stderr logs;
`guard-selftest/result.json`, `probe-resume-review/result.json`,
`verified-summary.json`, `independent-bind-back.json`. У кожному browser
підкаталозі 4 PNG, 4 traces, 4 HAR, `server.json`, `browser.json`.
Разом pair має 8 PNG / 8 traces / 8 HAR. Шляхи нижче з `$PWA_PHASE3` — для
вашого нового запуску; для вже виконаного eval замінити його цим root.

Parent незалежно повторив guard **5/0**, два browser invocations **8/0 кожен**
і retained assets **7/0** на новому shared profile/origin port 62805.
Додаткове evidence: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-parent-9JsNbW/`
(`verification.json`, `first/result.json`, `resume/result.json`, logs/PNG/trace/HAR).
Cleanup/bind-back PASS; screenshot waiting v2/v3 переглянуто parent.
Це повторне підтвердження, не додатковий унікальний test count.

### QA-3A. Guard і disposable control

**qa:mode:** cli
**qa:open:** термінал у `D:/work/fluid-paint/fluid-paint`; fixture URL під час runner — `http://127.0.0.1:3000/__pwa_fixture/`.
**qa:action:** виконати build та перший `npm run test:pwa-sw -- …` із recipe вище, на новому profile.
**qa:inspect:** stdout та `$PWA_PHASE3/guard-selftest/run1-online.png`; поля `runs[0].state`, `runs[0].active` у `result.json`.
**qa:expected:** Node guards 5 passed/0 failed; browser cases=8, status=PASS, exitCode=0; active.version=`v1`, state.active=`activated`, controller=`http://127.0.0.1:3000/sw.js`, scope=`http://127.0.0.1:3000/__pwa_fixture/`, updateViaCache=`none`. PNG показує «Fluid PWA phase 3 — fixture only», не painting app. Покрито пробою.

### QA-3B. Другий Node process бачить попередній profile

**qa:mode:** cli
**qa:open:** той самий термінал, `PWA_PHASE3` і profile після QA-3A.
**qa:action:** виконати `npm run pwa:sw:review -- … --resume` із recipe, не очищати site data/profile.
**qa:inspect:** `$PWA_PHASE3/probe-resume-review/result.json`, `persistedFromPreviousInvocation` та `run1-online.png`.
**qa:expected:** 8 cases PASS; resume=true, baseline=`v2`; до registration controller уже існує, active=`v2`, два caches/four entries byte-for-byte дорівнюють final cold snapshot QA-3A. Profile і origin ті самі; це не чистий профіль. Після probe збережено v3, три fixture caches/six entries. Покрито separate-process probe.

### QA-3C. Offline cold navigation після повного закриття

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/run1-cold-offline.png` та `run2-cold-offline.png`; underlying URLs — `http://127.0.0.1:3000/__pwa_fixture/?cold=run1-cold-offline` і `http://127.0.0.1:3000/__pwa_fixture/?cold=run2-cold-offline`.
**qa:action:** відкрити обидва real PNG, прочитати `coldStarts` і `cleanup.contextClosures` у result того самого runner.
**qa:inspect:** стале `offline: true`, active version, cached-byte текст, fromServiceWorker і browserDisconnected у JSON.
**qa:expected:** два coldStarts; offlineBeforeNavigation=true до першого navigation; response HTTP 200/fromServiceWorker=true; byte рівно `fluid-pwa-phase3-cached-byte\n` (29 bytes, SHA у звіті); versions v1/v2, усі попередні contexts мають browserDisconnected=true і закриті tabs. Не лише reload/live offline toggle. Покрито пробою; OS reboot не заявляється.

### QA-3D. Active/waiting request-ID protocol

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/run2-waiting.png`, відповідний result.json.
**qa:action:** відкрити PNG, знайти case `active v1 / waiting v2 request IDs ignore unrelated replies`.
**qa:inspect:** `states.active`, `states.waiting`, два `replies` з target/version/requestId; у headed probe аналогічно v2/v3.
**qa:expected:** active=`activated`, waiting=`installed`; active reply v1, waiting reply v2, різні UUID і elapsedMs<2000; injected unrelated request-ID reply `WRONG` не прийнято. Fixture не робить skipWaiting/clients.claim; після close natural activation. Покрито concurrent real MessageChannel requests.

### QA-3E. Негативний bounded timeout

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/result.json` і `run2-waiting.png`.
**qa:action:** знайти `negativeTimeout` і наступний `protocol` STATUS reply для waiting worker.
**qa:inspect:** expectedFailure, timeoutMs, elapsedMs, error і наступна version.
**qa:expected:** IGNORE не відповідає: expectedFailure=true, timeoutMs=250, error містить `SW_REQUEST_TIMEOUT waiting IGNORE` та UUID; 200≤elapsedMs<3000 (final eval 260ms). Наступний STATUS v2 успішний; тест PASS саме за очікувану відмову, не замаскований network failure. Покрито пробою.

### QA-3F. Cache bytes і production-like headers

**qa:mode:** cli
**qa:open:** `$PWA_PHASE3/guard-selftest/result.json` і `server.json`.
**qa:action:** прочитати `http`, `coldStarts[1].caches`, logs 404; виконати `npm run test:pwa-assets` з recipe.
**qa:inspect:** 19 inventory responses і 3 SW/metadata responses; byte entry URL/status/MIME/size/SHA; retained guard summary.
**qa:expected:** усі 19 production entries status=200, hashVerified=true і правильний MIME; hash-named assets immutable, HTML no-cache; `/sw.js`, `/release.json`, `/precache-inventory.json` no-store. Unknown JS має 404, не HTML fallback. Cache byte status=200, text/plain, 29 bytes, SHA `fdcb9c1acae2c9c5d0d836c55057415afdbc0b731f94f5a1e69dbf0cce8bf237`; retained assets 7/0; тепер production `dist/sw.js` існує з pinned releaseId, fixture його bytes не змінює (historical phase3 absence перевіряла попередній контракт). 405 перевіряє Node server guard, не browser log. Покрито guard+probe.

### QA-3G. Cleanup та bind-back

**qa:mode:** cli
**qa:open:** термінал у корені repo після обох runners; їхні result.json.
**qa:action:** виконати `node -e 'require("./debug/pwa-sw-harness").bindBack(3000).then(()=>console.log("portFree=true"))'`.
**qa:inspect:** stdout/exit code, `cleanup` у двох result.json; профіль лишається зовні, servers не відповідають.
**qa:expected:** stdout `portFree=true`, exit 0; serverStopped=true/portFree=true, contextsClosed=4 у кожному invocation, кожен browserDisconnected=true. Чужі процеси не зупиняти; fixture server не залишено. Команду й independent bind-back виконано до review.

## Фаза 2 — release identity та hashed assets (2026-10-14, прийнята)

Історичний eval реалізації: build PASS; guard: release **4/0**, phase-1 assets **7/0**, shader bundle
compatibility **25/0**. Probe: **2 WebGL cases PASS**, Chromium 153.0.8010.12 /
SwiftShader, два builds з однаковим releaseId, 19 inventory HTTP 200 + SHA-256
readback, hashed 404=0, shader XHR=0, page/GL errors=0. Phase-1 regression:
**2 viewport PASS** (1280×900, 320×900), 9 faces loaded на кожному, MIME/manifest.
Full `make verify` не запускався; числа різних рівнів не підсумовуються.

Evidence:
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase2-RREa45/result.json`
  (HAR, trace, server/two-build logs, metadata/inventory snapshots, 12 screenshots
  та 2 справжні PNG exports поруч).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791976458083-44816/result.json`
  (fresh phase-1 compatibility, HAR/trace/6 screenshots).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-guard-ONChpQ/result.json`
  (окремі build/guard logs і точні Node commands).
- `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase2-change-xYWmvD/result.json`
  (змінений title у isolated fixture змінює releaseId, main checkout untouched).

Власні servers завершені, обидва останні runs port=3000 / portFree=true.
Review stand **не залишений**: запустіть свою команду вище. QA-2B–2G виконуються
послідовно в одній вкладці, повторити для `webgl=1` і `webgl=2`. Recipe обмежує
GPU allocations як існуючі Paint probes; це не новий production preset.

### QA-2A. Детермінізм, inventory та stale outputs

**Відкрити:** термінал у `D:/work/fluid-paint/fluid-paint`, сервер зупинений.
**Клікнути:** нічого; виконати `NODE_ENV=production node --test debug/pwa-release-test.js`, потім `npm run test:pwa-assets`.
**Дивитись:** test summary; `dist/release.json` і `dist/precache-inventory.json`.
**Очікуваний результат:** release 4 passed/0 failed, assets 7 passed/0 failed; обидва JSON мають однаковий 64-hex releaseId. Два real builds byte-identical за inventory; stale file/directory прибрані, changed HTML змінює identity; усі shell references resolve. Required inventory = 19 entries, без shader/SW/metadata; імена JS/CSS/WOFF2/PNG/manifest містять content SHA-256. Команди виконано до review; encoded contract — HANDOFF «Canonical encoding v1».

### QA-2B. Малювання на hashed production bundle

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, viewport 960×720; для повтору `http://127.0.0.1:3000/?webgl=1&debug=none&diag=0&seed=41`.
**Клікнути:** у Console виконати recipe нижче; потім провести лівою кнопкою з (504,305) до (576,305) всередині білого полотна.
**Дивитись:** біле полотно посередині, синій мазок; Network JS/CSS URLs.
**Очікуваний результат:** 180×130 полотно з видимою синьою фарбою; JS/CSS hash-named, HTTP 200, без shader XHR/404/page errors. Покрито actual Playwright mouse events + GPU materialMagnitude>0; не фізичний GPU QA. Recipe виконано у браузері:

```js
const p=window.__painter;p.paintingRectangle.left=450;p.paintingRectangle.bottom=350;p.paintingRectangle.width=180;p.paintingRectangle.height=130;p.engine.resizePainting(p.getPaintingResolutionWidth(),p.getPaintingResolutionHeight(),0,0);p.setPaintColor('#3B82F6');p.needsRedraw=true;
```

### QA-2C. Painting resize та viewport resize

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, продовжити QA-2B (повтор з `webgl=1`).
**Клікнути:** у Console виконати блок нижче; змінити DevTools viewport із 960×720 на 1000×740.
**Дивитись:** розмір білого полотна та збережений синій мазок; Console result.
**Очікуваний результат:** width=196, height=142, previewError=0, commitError=0; canvas й мазок не пропадають при viewport resize. Покрито probe через existing preview/commit API + реальний viewport resize; edge drag цим сценарієм не заявляється. Виконаний блок:

```js
(()=>{const p=window.__painter;p.newPaintingRectangle=p.paintingRectangle.clone();p.newPaintingRectangle.width+=16;p.newPaintingRectangle.height+=12;p.resizingSide=ResizingSide.TOP_RIGHT;p.interactionState=InteractionMode.RESIZING;p.needsRedraw=true;p.update();const previewError=p.wgl.gl.getError();p.interactionState=InteractionMode.NONE;p._commitResize();p.needsRedraw=true;p.update();return {width:p.paintingRectangle.width,height:p.paintingRectangle.height,previewError,commitError:p.wgl.gl.getError()};})()
```

### QA-2D. Bake не губить rendered artwork

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41` (продовжити QA-2C; повтор з `webgl=1`).
**Клікнути:** `#panel-grip` → `#panel-extension-toggle` (+) → State (`#bake-tab`) → `#bake-button`; після появи статусу закрити extension `#panel-extension-toggle` і згорнути панель `#panel-grip`.
**Дивитись:** `#bake-status`, Undo/Redo та artwork після згортання панелей.
**Очікуваний результат:** стійкий текст «Baked. Wet paint and Undo history were reset.»; Undo/Redo disabled, artwork збережено. Probe додатково asserted rendered max delta=0, wet magnitude=0, hasBackground=true; screenshots `webgl*-bake.png` (UI) і `webgl*-baked-artwork.png` (art). Покрито реальним Bake DOM click, не mock.

### QA-2E. Справжній PNG download

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка після QA-2D (повтор з `webgl=1`).
**Клікнути:** `#panel-grip` → Save As… (`#save-button`); зберегти PNG.
**Дивитись:** завантажений PNG у image viewer.
**Очікуваний результат:** PNG 196×142 містить синій artwork, не порожній output. Probe реально отримав download і зберіг `webgl1-export.png`/`webgl2-export.png`, перевірив PNG signature/dimensions/download.failure=null. Це flattened PNG, не checkpoint wet state/Undo.

### QA-2F. Локальний PNG import

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка QA-2E (повтор з `webgl=1`).
**Клікнути:** + (`#panel-extension-toggle`) → File (`#story-file-tab`) → Choose file; `#story-file-input`, вибрати PNG, збережений у QA-2E (автопроба використовує свої `webgl*-export.png`).
**Дивитись:** background card `#story-background-name` і artwork.
**Очікуваний результат:** card показує вибраний filename; renderer.hasBackground=true; summary sourceWidth=196, sourceHeight=142, PNG стає background. Покрито справжнім local file-input, screenshot `webgl*-import.png`.

### QA-2G. Локальний story JSON import

**Відкрити:** `http://127.0.0.1:3000/?webgl=2&debug=none&diag=0&seed=41`, та сама вкладка QA-2F (повтор з `webgl=1`).
**Клікнути:** File → Choose file (`#story-file-input`), вибрати `D:/work/fluid-paint/fluid-paint/docs/story-2026-09-08-4-frames.json`.
**Дивитись:** Player, `#story-player-file-name`, кнопки story controls.
**Очікуваний результат:** автоматично відкрито Player; filename `story-2026-09-08-4-frames.json`, controller.state=`ready`, без page errors. Retained fixture доступний у checkout; import покрито probe, playback не acceptance фази 2.

## Фаза 1 — локальні assets (2026-10-14, прийнята)

Історичний eval реалізації: build PASS; guard **7 passed / 0 failed**; браузерна проба
**2 viewport PASS** (1280×900 і 320×900), Chromium 153.0.8010.12 / SwiftShader.
Це окремі рівні, не «9 тестів». На кожному viewport завантажено 9 локальних
font faces (3 subsets × 3 weights), manifest має 0 parse errors, page errors = 0.
Google font requests = 0; невдалих same-origin assets = 0. Іконки декодовані
як 192/512 any, 192/512 maskable і 180 apple touch. HTTP MIME перевірено для
webmanifest/png/svg/woff2; SVG — тимчасовий probe-файл, прибраний після запуску.

Докази остаточного запуску:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa/phase1-1791974679450-60396/`:
`result.json`, `network.har`, `trace.zip`, `server.log`,
`1280-panel.png`, `1280-file.png`, `1280-state.png`,
`320-panel.png`, `320-file.png`, `320-state.png`.
Порт 3000 звільнений пробою та незалежно повторно перевірений bind-операцією.
Попередні scratch/failed runs у Temp — не acceptance evidence.

### QA-1A. Desktop: панель і слайдер

**Відкрити:** `http://127.0.0.1:3000/`, viewport 1280×900.
**Клікнути:** grip `#panel-grip`; `#fluidity-slider` приблизно на 70% ширини.
**Дивитись:** основна панель, назви Paint Fluidity / Bristle Count / Brush Size, повзунок Fluidity.
**Очікуваний результат:** панель розгорнута, три слайдери видимі, повзунок переходить до місця кліку; панель і тексти не обрізані. Покрито браузерною пробою; пропорції перевірити очима.

### QA-1B. Mobile: панель і слайдер

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці, DevTools viewport 320×900.
**Клікнути:** `#panel-grip`; `#fluidity-slider` приблизно на 70% ширини.
**Дивитись:** панель від x=12 до x=308, підписи, слайдери та нижні Clear / Save As… .
**Очікуваний результат:** ширина панелі 296px, усі основні controls у viewport, назви читабельні, повзунок реагує. Покрито пробою; не є фізичним mobile QA.

### QA-1C. Story File controls

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на 1280×900 і 320×900.
**Клікнути:** `#panel-grip` → `#panel-extension-toggle` (+) → вкладка File (`#story-file-tab`).
**Дивитись:** вкладки Demo / File / Player / State та dropzone `#story-file-dropzone`.
**Очікуваний результат:** File selected; видно «Drop Story JSON or PNG», «or choose a local file», «.json / .png · max 25 MB» без обрізання. На 320px extension накладається на основну панель — чинна поведінка, не новий dock. Покрито пробою; сам імпорт у цій фазі не перевіряється.

### QA-1D. Story Player empty state

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на обох viewport.
**Клікнути:** `#panel-grip` → + → File → Player (`#story-player-tab`).
**Дивитись:** `#story-player-empty` і кнопку Choose file.
**Очікуваний результат:** видно «No story loaded» та «Load a Tilecraft JSON file to enable playback.»; Player відображається без завантаженої story. Покрито пробою; playback не заявляється як перевірений.

### QA-1E. State controls

**Відкрити:** `http://127.0.0.1:3000/` у новій вкладці; повторити на обох viewport.
**Клікнути:** `#panel-grip` → + → File → Player → State (`#bake-tab`); Bake не натискати.
**Дивитись:** Brush Angle, пояснення Bake та `#bake-button`.
**Очікуваний результат:** тексти й зелена кнопка «Bake» всередині viewport; Brush Angle disabled для Round. Покрито пробою; сам Bake не входить у цей probe.

### QA-1F. Fonts локальні, без Google

**Відкрити:** `http://127.0.0.1:3000/` із Network → Disable cache, після Reload.
**Клікнути:** `#panel-grip`; у Console виконати ``for (const weight of [400,600,700]) await document.fonts.load(`${weight} 14px "Open Sans"`, 'Paint Fluidity Ї Є Ґ Ł'); await document.fonts.ready;``.
**Дивитись:** Network filter `woff2`; окремо filter `googleapis` та `gstatic`; Console `Array.from(document.fonts).map(f => ({family:f.family,weight:f.weight,status:f.status}))`.
**Очікуваний результат:** дев'ять Open Sans normal faces 400/600/700 loaded; WOFF2 із `/assets/fonts/open-sans/`; 0 запитів до fonts.googleapis.com/fonts.gstatic.com. Latin/Latin-ext/Cyrillic завантажуються локально, не fallback. Покрито пробою через FontFaceSet та HAR.

### QA-1G. Manifest та іконки

**Відкрити:** `http://127.0.0.1:3000/`, DevTools → Application → Manifest.
**Клікнути:** нічого; переглянути manifest та previews іконок.
**Дивитись:** name/short_name, id, start URL, scope, display, чотири icon previews; apple tag у Elements.
**Очікуваний результат:** Fluid Paint; id/start_url/scope `/`; standalone; theme/background `#202024`; PNG 192/512 any і 192/512 maskable; apple 180×180. 0 manifest parse errors (CDP `Page.getAppManifest`), усі п'ять PNG декодуються. Install/offline warnings без SW у фазі 1 не є parse failures. Парсинг/декодування покрито пробою, UI DevTools перевіряє людина.

### QA-1H. MIME та cleanup

**Відкрити:** термінал у `D:/work/fluid-paint/fluid-paint`, після зупинки ручного сервера.
**Клікнути:** нічого; виконати `PWA_QA_PORT=3000 npm run test:pwa-assets:browser`.
**Дивитись:** підсумок у терміналі та `mime` у надрукованому каталозі `result.json`.
**Очікуваний результат:** PASS, pages=2, googleFontRequests=0, port=3000, portFree=true; HTTP 200 з `application/manifest+json`, `image/png`, `image/svg+xml`, `font/woff2`; власний сервер не лишається працювати. Команду виконано до review.

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

## Журнал фаз

- 2026-10-15 — фаза 7 **прийнята власником через `handoff:next`, закрита із обов’язковим UX follow-up 7A перед 8**. Closing commit поверх `5d900c1`; deploy не виконано. Історичний final eval PASS, 22 commands exit 0; свіжі closing checks окремо наведено вище. 7A лише специфіковано, не реалізовано; чекати `start 7A`. Фаза 8 заблокована до acceptance 7A. NOT TESTED і cleanup-readback limitation збережено.

- 2026-10-15 — фаза 6 **прийнята власником через `handoff:next`, закрита**.
  Closing commit поверх `5d876c7`; deploy не виконано. Історичний final eval —
  QA-6 та PHASE6-REPORT; 20 commands exit 0. Свіжі closing guards наведено у QA-6.
  Далі фаза 7 після окремого дозволу; всі NOT TESTED межі збережено.

- 2026-10-15 — фаза 5 **прийнята власником через `handoff:next`, закрита**.
  Closing commit поверх `feba360`; deploy не виконано.

Closing check 2026-10-15: production build PASS; свіжі окремі guards:
readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**, harness **5/0**.
Browser evidence повторно прочитано без перезапуску: історичні readiness 13 cases,
production 10 cases, assets 2 viewport, release 2 WebGL, fixture 8 cases — PASS.
Native install/iOS-device та всі NOT TESTED межі збережено. Scratch-port
readback EACCES з попереднього parent review лишається disclosed, не browser FAIL.


- 2026-10-15 — фаза 4 **прийнята власником через `handoff:next`, закрита**.
  Closing commit поверх `66c65e1`; deploy не виконано. Свіжі closing checks:
  production build PASS; worker 10/0, release 4/0, assets 7/0, harness 5/0.
  Browser results повторно прочитано: історичні production 10 cases PASS,
  assets 2 viewport, release 2 WebGL, fixture 8 cases; проби не перезапускались.
  Port 3000 bind-back PASS. Межі NOT TESTED збережено. Історичний next-work — фаза 5; тепер вона також закрита.

- 2026-10-14 — фаза 3 **прийнята власником через `handoff:next` і закрита**.
  Код/документи входять у closing commit поверх `ff429d4`; deploy не виконано.
  Свіжий closing build PASS, harness guard 5/0, retained assets 7/0.
  Browser evidence вище повторно прочитано: історичні first/resume 8/0 кожен,
  проби не перезапускались. Port 3000 незалежно bind-back PASS.
  Межі NOT TESTED збережено. Історичний next-work тоді — фаза 4; тепер вона також прийнята й закрита.

- 2026-10-14 — фаза 2 прийнята власником (`handoff:next`) і закрита.
  Closing build PASS; свіжі guards release 4/0, assets 7/0, shader 25/0
  через прямі Node entrypoints (npm shell invocation завершився timeout, не PASS).
  Browser результати нижче історичні; evidence PASS/exitCode=0/portFree=true
  повторно прочитано, без перезапуску проб. Межі NOT TESTED збережено.
  Guard 4/0 + regression assets 7/0 + shader 25/0; browser 2 WebGL cases PASS,
  phase-1 regression 2 viewport PASS. Evidence вище, servers cleaned up.
  Історичний next-work тоді: фаза 3; тепер вона також закрита.
  Фаза 2 включена в closing commit; production deploy не виконано.
- 2026-10-14 — фаза 1 прийнята власником (`handoff:next`) і закрита;
  closing build PASS, guard 7 passed / 0 failed. Browser evidence вище
  збережено; фізичні Android/iOS NOT TESTED. Deploy не виконано.
  Історичний next-work тоді: фаза 2; тепер 1–4 закриті, 5–10 не починались.

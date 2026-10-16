# Фаза 8 — cleanup + дві вкладки

Статус: прийнято власником через `handoff:next` 2026-10-16; closing UI та eval — HANDOFF.md. Нижче первинний implementation snapshot.
Авторизація: «Роби змінену фазу 8». Commit/deploy/оновлення retained dist не виконано.
Старі history/cap3/quota-framework/local-rollback вимоги скасовані, не борг.

## Зміна

- `app/pwa-worker.js`: cleanup на activate та STATUS; лише active release може
  збирати непотрібні caches точного namespace `fluid-pwa-shell-v1-<sha>-<uuid>`.
- `app/pwa-register.js`: STATUS передає identity **завантаженого документа**,
  не identity нового controller. Власний PNG/safety/once-only reload не змінено.
- `fluid-pwa-liveness-v1` містить службові document pins/shell mapping/active
  identity, не копії версій. Під час navigation resultingClientId закріплюється
  до повернення HTML; відомий live pin не потребує відповідей від frozen вкладки.
- Web Locks серіалізує collection/pinning/cache creation. Network install не
  утримує lock: повільне завантаження не блокує STATUS поточного застосунку.
  Installing/waiting candidate забороняє collection інших releases.
- Unknown/uncontrolled/legacy client з невідомим shell відтерміновує cleanup,
  але не Update. No forced reload/clients.claim, no leases/timeouts як доказ
  відсутності. Закриті observed clients прибираються з pins, і наступний STATUS
  видаляє непотрібний release. Чужі caches, user data та demos не чіпаються.

## Виконана перевірка

Команда з shared checkout, усі builds/profiles/evidence лише в зовнішньому Temp:

```sh
node debug/pwa-phase8-browser-test.js
```

Фінальні докази: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase8-bWky0A` (`$E`).
`result.json` PASS, 9 browser cases; обидва production builds exit0.
Real Chromium/SwiftShader, actual SW/CacheStorage, не physical mobile.
V2 у copied source має лише доданий fixture-marker
`window.__phase8FixtureBuild = "V2"`, щоб створити інший JS hash: старий bundle
справді відсутній у V2 inventory. Canonical production source не змінюється
fixture-marker'ом. `source-fingerprint.json` фіксує input до fixture mutation.

- Guard (свіжі окремі parent reruns, `parent-guards.json`): cleanup **15/0**,
  worker **12/0**, activation **11/0**, autosave **9/0**, detection **16/0**,
  readiness **11/0**, UX **4/0**. Combined runner: 78 executions/0 failed;
  suites перекриваються через imported activation cases, не 78 унікальних assertions.
- V1: `e543f4de10efceb368e64414d6796c91a8030b23420bd6201d10656bb98f035f`.
  V2: `86b40fd7d94070b11c014597b5a3ae2288626a062c72525f4ed0231103a85929`.
- Network disconnect required V2 JS: install відхилено, немає partial/waiting
  V2 cache, V1 ready й обидва реальні малюнки збережені.
- Complete waiting V2 зберігається окремо. Explicit Update: auto-PNG перед
  єдиною navigation, exact V2 active STATUS отримано **до thaw** другої вкладки.
  Паралельна нова вкладка boot'иться без mixed release.
- Nonconsenting стара вкладка: нуль navigation, той самий document marker,
  реальний artwork і PNG; 18 старих hashed assets HTTP200/SHA-exact offline,
  включно з унікальним старим bundle.
- Після закриття old painting вкладки unknown credits document ще захищає кеш.
  Після закриття unknown/extra вкладок наступний STATUS видалив V1, V2 complete.
  Foreign/demo/user caches, localStorage та IndexedDB sentinels readback unchanged.
  Це перевірка storage isolation, не реалізований download demos scope C.
- V2 після cleanup reload'иться offline й знову приймає реальні pointer strokes.
- Auto PNG: 180×130, 15865 bytes, 6244 colored pixels,
  SHA `d1efd19335f5c4021e7da76c540349e9303937f9c4c7f378eaae09fe12ccdc9f`.
  Old-tab PNG: 180×130, 17085 bytes, 6572 colored pixels,
  SHA `728cdaa6e7947c7dff6fa4d0f952d7ab8fcfb020d055a9c0d75a07c9ea2b0035`.
- Screenshots: `$E/old-artwork-after-update.png`, `v2-after-update.png`,
  `v2-offline-ready-draw.png`; HAR/trace та before/after cache JSON збережено.
  Parent візуально перевірив old artwork screenshot: непорожній синій малюнок.
- Own browser closed/disconnected; own port58194 bind-back PASS.

## Межі та консервативне відтермінування cleanup

- Без Web Locks cleanup вимкнений; install/serving продовжуються. Це guard PASS,
  не browser/physical coverage цього fallback. Відсутність lock не спричиняє
  небезпечного видалення. Немає обіцянки cleanup у кожному браузері.
- Reserved navigation pin, який жодного разу не спостерігався як живий client,
  не видаляється за таймером: aborted/unobserved navigation може залишити pin
  й відтермінувати collection на невизначений час. Старий legacy або embedded
  документ без відомого identity також консервативно утримує кеш до закриття.
  Це явно збережене обмеження, не «всі старі кеші завжди прибираються».
- Реальний OS/mobile suspension, Safari, Android/iOS standalone, відмова locks,
  quota/eviction у справжньому браузері, crash у момент durable pin write,
  aborted-navigation cleanup і міграція з раніше опублікованого legacy SW
  не перевірені browser probe. Network install refusal перевірено реально;
  quota refusal — чинним deterministic worker guard.
- No full make verify, новий deploy/CDN/CORS QA або offline demos acceptance.
- 3000 зараз ECONNREFUSED до й після прогону. Не запускав/не зупиняв цей сервер.
  Усі 54 retained dist files SHA-identical до parent baseline перед делегацією;
  три pre-existing unrelated files також SHA-identical. Без live-server claim.

## Попередні невдалі спроби

Делегація обірвалася без terminal result; не є завершенням фази.
Збережені LCxLqJ/oDF5DV/OxIKEe attempts містять activation/readiness timeout та
build timeout; вони не PASS. Відновлений parent runner спочатку виявив
ECONNREFUSED retained3000: тепер записує недоступність замість припущення, що
сервер обов'язково живий. Попередній parent `fluid-pwa-phase8-oISffs` PASS був
слабшим (однакові JS hashes), тому фінальна acceptance спирається на bWky0A з
різними bundle hashes. Невдалу історію не підмінено чистим безперервним запуском.

Історичний наступний крок перед acceptance: human review [QA-8](./QA.md#фаза-8--cleanup--дві-вкладки-review).
Фаза 9 не починається без acceptance/окремої команди; production deploy окремо.

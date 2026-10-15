# Фаза 6 — headers та detection state machine

Стан на 2026-10-15: **прийнято власником через `handoff:next`, фазу 6 закрито**.
Baseline `5d876c72db58255e2ceea3fcad9a1e44961e8f89`. Фази 1–5 прийняті.
Closing commit поверх baseline; deploy не виконано, production не змінено.
[QA-6A–6H](./QA.md). Далі фаза 7 після окремого дозволу власника.

## Реалізація та межі

- `app/pwa-register.js`: production-only detection поруч із чинними readiness та
  install UX. `updateViaCache: 'none'` збережено. `createDetection()` обробляє
  existing waiting **до** першого updatefound, installing/active/waiting
  statechange, updatefound, redundant failure і controllerchange. Worker
  listeners дедупліковані за object identity; epoch та перевірка поточних
  object references відкидають застарілі STATUS replies. Request UUID,
  MessageChannel та timeout 2000ms із закриттям портів збережено.
- Identity отримується від actual active/waiting worker; лише complete=true та
  64-hex releaseId дозволяють показати waiting identity/ready. Pinned-shell
  readiness окремо й далі перевіряє actual controller===active, activated та
  shellId з завантаженого HTML; latest network metadata не замінює цей доказ.
- `registration.update()` викликається на startup, foreground, online, manual
  та 15-хвилинний visible timer. Automatic throttle 60000ms; manual bypass;
  concurrent calls coalesce в один Promise. Timer прибирається hidden та
  перевстановлюється після кожної фактичної перевірки, включно з failure та
  довгою in-flight перевіркою. Повернення visible робить throttled attempt.
  Немає обіцянки background detection у закритому/suspended browser.
- UI: active/waiting повні content identities, last-check time/result,
  indeterminate `<progress>` без value і без вигаданих %. «Пізніше» лише
  відкладає notification для тієї самої waiting identity, не активує worker.
  Offline/check failure не означає «оновлень немає»; late local STATUS не
  стирає failure. Genuine install UX, embedded exclusions та warning збережено.
- Немає skipWaiting, clients.claim, reload, activation marker, dirty/export
  gate чи phase-7 «Оновити». V2 лишається waiting; safe activation — наступна
  фаза. Physics/palette/vendor не змінені.

### Hosting: чому immutable не є широким glob

`netlify.toml`: точні `/sw.js`, `/release.json`, `/precache-inventory.json`
отримують no-store; `/` і `/index.html` — no-cache. Immutable правила для
**точних generated hash paths** формує `debug/pwa-release-build.js` у
`dist/_headers`. Не використано `/*.js`, `/bundle.*.js` чи псевдо-regex у TOML:
широкий Netlify path pattern не є перевіркою повного SHA-256 і міг би зачепити
нехешовані файли. `_headers` містить лише inventory assets, без HTML; fixed
`/bundle.js`, `/app/layout.css`, manifest, SW і metadata ніколи не мають цього
immutable правила. Новий build очищає старі definitions разом із dist.
Це уточнення механізму canonical вимоги, а не зміна naming scheme фази 2.
Guard звіряє definitions з inventory та відмовляє wildcard rules.
**Live Netlify/CDN response headers NOT TESTED:** deploy заборонено. Локальний
production-like harness дає actual HTTP/MIME/SHA/header readback, але не
видається за CDN validation чи Netlify CLI emulator.

## Свіжий final eval

З кореня `D:/work/fluid-paint/fluid-paint`, без паралельних dist writers:

```sh
node debug/pwa-phase6-eval.js
# Вузький повтор:
NODE_ENV=production node node_modules/gulp/bin/gulp.js build
node --test debug/pwa-detection-test.js
node debug/pwa-detection-browser-test.js
```

Runner PASS / exit 0: **20 top-level commands, кожна exit 0**. Exact executable,
args, cwd, env, stdout/stderr paths і codes — root `result.json`. Internal
builds probes/guards мають власні logs; не додавати їх як нові suites.
Evidence **поза repo**:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase6-final-Bxucp5/`.
Node 24.19.0, Chromium 153.0.8010.12, SwiftShader.

Guard, окремі suites passed/failed:

- detection **15/0**;
- readiness **11/0**;
- worker **10/0**;
- release **4/0**;
- assets **7/0**;
- harness **5/0**;
- shader **25/0**;
- demo **8/0**;
- palette **6/0**;
- control API PASS (без enumeration).

Builds та `git diff --check` PASS. Timer/throttle/coalescing, hidden stop,
completion rearm, failed worker, duplicate events, stale identity, request IDs
і timeout перевіряє **реальний production factory з injected clock/worker
EventTargets**, не окрема копія алгоритму. Це guard, не 15 хвилин wall-clock QA.

Browser suites, не сумувати з guard чи між різними рівнями:

- `detection-browser/result.json`: **7/0**;
- `readiness-browser/result.json`: **13/0**;
- `production-regression/result.json`: **10/0**;
- `assets-regression/result.json`: **2 viewport PASS**;
- `release-regression/result.json`: **2 WebGL PASS**;
- `fixture-regression/result.json`: **8 cases PASS**.

### Реальна production V1/V2 probe

Два справжні production builds із різними HTML **і bundle bytes**, frozen v1/v2,
один localhost origin та persistent profile. V2 source fixture змінює title і
UI label; checkout HTML/engine не змінюється. Actual identities:

- V1 `32c318ca80267327a6faa8b679730b046d44b26883166583636ddd7075c35b77`;
- V2 `329d9fdc34cd3fbe0c2b4a5ce775bb5464da2d06d86a01fc6a354f09d2bb3d46`.

Перший required JS 404 дає redundant/failed без waiting і з active V1.
Наступний manual UI click дає verified complete V2 waiting при active V1.
Actual «Пізніше» click не reload/activate; наступна окрема вкладка отримує
pinned V1 shell від SW і бачить already-waiting V2 ще до нового updatefound.
320×900: x=12, width=296, horizontal overflow=false; full IDs переносяться.
Offline manual UI check дає failed/чесний текст, не no-update; V2 лишається.
V1 далі малює реальним pointer stroke offline та експортує справжній PNG
180×130. Active/waiting IDs незмінні, URL/title не reload; loaded scripts лише
з V1 inventory. Обидва complete caches побайтно звірені з власним inventory.
Retained production regression окремо доводить offline WebGL1/2 draw, resize,
Bake, PNG/local import/story subset playback, failed upgrades, controlled
embedded handshake та natural activation лише після закриття clients.

У `detection-browser/`: frozen `v1/`, `v2/`, `source/`, `profile/`,
`cache-snapshot.json`, `server.json`, `browser.json`, 1 HAR, 1 trace ZIP та
**9 PNG** (8 screenshots + actual exported PNG): `v1-ready.png`,
`failed-install.png`, `v2-waiting.png`, `later-v1.png`,
`existing-waiting-bootstrap.png`, `320-waiting.png`, `offline-check-failed.png`,
`later-v1-drawing.png`, `later-v1-export.png`. Final narrow/drawing screenshots
переглянуті очима: текст і warning читабельні, мазок непорожній.

Own browsers disconnected, servers stopped; separate-process bind-back всіх
final ports **61749/52260/54432/49202/59812/64177/56608 PASS**. Review stand не
залишено. Профілі не видалено; чужих процесів не зупиняли.

Post-document readback: `node C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase6-final-Bxucp5/verify-evidence.js`
PASS; `post-document-verification.json` перевіряє всі 20 command codes/logs,
suite/probe counts, signatures/JSON для **99 media artifacts**, document links,
порожній index, незмінність physics/palette/vendor та збіг поточного dist із
final V1 identity. Повторний bind-back охоплює також усі відомі власні порти
scratch/intermediate/failed attempts. Це окремий readback, не нові browser cases.

## Виявлене, виправлене, історичні невдалі спроби

- Scratch `FtRGrq`, `VuZWwp`, `ObPtW9` виявили Chromium поведінку: update()
  може resolve offline за вже installed waiting candidate. Тепер перевірка
  **все одно виконує update()**, але offline signal не підвищує результат до
  network success/no-update; local identity refresh не стирає failure.
  `PXkHdF` був intermediate PASS до фінального regression hardening.
- Перший integrated `fluid-pwa-phase6-final-WTsiJM` мав усі guards та перші
  чотири browser suites PASS, але readiness probe FAIL через зайве readiness
  flashing на кожному update render. Reverification прив'язано до зміни active
  identity, а не кожного progress/render; final **повний rerun** вище PASS.
  Ці попередні спроби не є acceptance evidence.
- Нові інваріанти: failed/offline network result не стирається local STATUS;
  long in-flight check не вбиває наступний timer; immutable definitions містять
  тільки exact full-SHA inventory paths. Guards — `pwa-detection-test.js`,
  probe — `pwa-detection-browser-test.js`.

## NOT TESTED / залишені межі

Physical Android/iOS, real Safari/A2HS/standalone, native GPU, OS reboot,
15-minute wall-clock/mobile suspended lifecycle, native install system dialog
(Chromium не надав genuine offer), quota/automatic eviction, browser MIME/hash
fault injection, full large-story completed playback, live CDN/Netlify headers,
CORS/demo download та full `make verify` — **NOT TESTED**. Node fault branches
і Chromium UA preview не є physical acceptance. No phase7 activation/reload,
retention/cap/rollback чи offline demos. Production deploy заборонено. Фаза 6
прийнята власником зі збереженням усіх перелічених NOT TESTED меж.

## Closing check

Closing check 2026-10-15: production build PASS; свіжі окремі guards detection
**15/0**, readiness **11/0**, worker **10/0**, release **4/0**, assets **7/0**,
harness **5/0**. Збережені browser results повторно прочитано без перезапуску:
detection **7 cases**, readiness **13 cases**, production **10 cases**, assets
**2 viewport**, release **2 WebGL**, fixture **8 cases** — історичні PASS.
Evidence readback PASS до closure edits: 20 command codes, 99 media artifacts,
всі final/scratch порти bind-back PASS. Всі NOT TESTED межі збережено.

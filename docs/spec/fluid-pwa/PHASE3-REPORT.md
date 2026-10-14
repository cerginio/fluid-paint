# Fluid PWA — фаза 3: harness, review report

2026-10-14. **Прийнято власником через `handoff:next`, фазу 3 закрито.**
Код і closure-документи входять у closing commit поверх `ff429d4`.
Фази 1–2 лишаються прийнятими. Deploy не виконано. Production app/engine,
Gulp/Netlify та build-generated assets не змінювались цією фазою.

## Що доведено

- `debug/pwa-sw-harness.js`: import-safe reusable production-like HTTP server,
  persistent Chromium launch/close, registration, CacheStorage inspection
  (URL/status/MIME/size/SHA-256 і текст лише для text payload), active/waiting
  MessageChannel protocol із UUID, фільтрацією чужих request IDs і timeout.
  Закриття завершує всі tabs та browser; server stop має bind-back proof.
- `debug/pwa-sw-fixture.js`: **викидний**, in-memory `/sw.js`, scope тільки
  `/__pwa_fixture/`; HTML і 29-byte text отримані справжнім network fetch у
  install і потім віддані з CacheStorage. Жодного запису SW у `dist`, app
  registration, `skipWaiting()` чи `clients.claim()`.
- `debug/pwa-sw-selftest.js`: CLI selftest, `--review` (headed, автоматично
  закривається), `--profile`, `--evidence`, `--port`, `--resume`.
  Default створює новий profile під `os.tmpdir()`; повторний **окремий Node
  process** із `--resume` читає попередній SW/cache до будь-якої registration.
  Profile marker зберігає version/origin/cache snapshot; origin не можна змінити.
- `debug/pwa-sw-harness-test.js`: 5 static/server guards. Package scripts:
  `test:pwa-sw` (guard + real selftest), `test:pwa-sw:browser` (selftest),
  `pwa:sw:review` (headed). Сценарії [QA-3A–3G](./QA.md) виконані до review.

## Історичний eval реалізації

| Рівень | Результат |
| --- | --- |
| `npm run build` | PASS, exit 0 |
| `npm run test:pwa-sw -- …` | Node guards **5 passed / 0 failed**; actual browser selftest **8 cases PASS / 0 failed** |
| `npm run pwa:sw:review -- … --resume` | separate-process probe, same profile/origin: **8 cases PASS / 0 failed** |
| `npm run test:pwa-assets` | retained guard **7 passed / 0 failed**, no production SW |

Node 24.19.0, Chromium 153.0.8010.12, Windows x64. Npm scripts виконано через
справжній npm CLI Node entrypoint, не підмінено окремими guessed commands.
У кожному browser invocation: 2 logical runs, 2 offline cold launches,
4 persistent browser processes закрито (`browserDisconnected=true`), 0 page
errors; усі 19 production inventory entries HTTP 200 + SHA/MIME/header readback,
3 SW/metadata no-store responses. Negative `IGNORE` request має timeout 250ms,
фактичне elapsed записане в result; після нього `STATUS` успішний.

Перший invocation: active v1 / waiting v2 → natural activation → offline v2;
другий до registration бачить v2 і той самий cache snapshot → active v2 /
waiting v3 → offline v3. Complete cache snapshots: 2 caches / 4 entries після
першого, 3 / 6 після другого. Це fixture retention, **не acceptance фази 8**.
Byte SHA-256: `fdcb9c1acae2c9c5d0d836c55057415afdbc0b731f94f5a1e69dbf0cce8bf237`.
Offline задано до першого navigation після повного close, не лише live toggle;
обидва navigation responses мають `fromServiceWorker=true`.

## Exact evidence

Корінь: `C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-final-JSzEQD/`.

- `result.json`: точні 4 npm commands, exit codes, shared profile path.
- `build.stdout.log`, `build.stderr.log`, `guard.stdout.log`, `guard.stderr.log`,
  `probe.stdout.log`, `probe.stderr.log`, `retained-assets.stdout.log`,
  `retained-assets.stderr.log`.
- `guard-selftest/result.json`, `probe-resume-review/result.json`: browser
  states, request IDs/timeouts, full cache snapshots, HTTP readback та cleanup.
- У **кожному** з двох підкаталогів: 4 real screenshots
  (`run1-online.png`, `run1-cold-offline.png`, `run2-waiting.png`,
  `run2-cold-offline.png`), 4 `*-trace.zip`, 4 `.har`, `server.json`, `browser.json`.
  Разом у цій acceptance pair: **8 PNG, 8 traces, 8 HAR**; жодного evidence у repo.
- `independent-bind-back.json`: додаткова незалежна bind-операція на 3000.

Власні HTTP servers зупинені; кожен runner підтвердив `portFree=true`.
Review server не залишений. Playwright profile збережений зовні для replay.

## Незалежна parent verification

Повторено guard і два окремі headless Node invocations на новому shared
profile/origin (port 62805), після inspection реалізації: guard **5/0**,
first **8/0**, resume **8/0**, retained assets **7/0**. Evidence:
`C:/Users/cergi/AppData/Local/Temp/fluid-pwa-phase3-parent-9JsNbW/` —
`verification.json`, чотири command logs, `first/result.json`,
`resume/result.json`, real PNG/trace/HAR. Обидва invocations мають два
SW-served offline cold starts, чотири disconnected browser closures та
server stop/bind-back PASS. Timeout: 260ms/261ms при deadline 250ms.
Parent переглянув `resume/run2-waiting.png`: fixture active v2/waiting v3,
різні request IDs і expected timeout читабельні. Port 3000 також незалежно
bind-back PASS. Це повторна перевірка, не додаткові унікальні tests.

## Closing check

2026-10-14: production build PASS; harness guard 5/0, retained assets 7/0 —
свіжі окремі suites. Browser evidence first/resume 8/0 кожен повторно прочитано,
проби не перезапускались. Незалежний bind-back port 3000 PASS.

## Межі та знайдене

Це infrastructure spike, не production offline/update acceptance. Android/iOS,
standalone/A2HS, OS reboot, storage eviction, CDN headers/deploy, atomic required
asset install failures, app painting offline та фази 4–10 — NOT TESTED.
У scratch runs виявлено timing race при читанні waiting state; виправлено
bounded browser-side polling до `waiting.state === 'installed'`, і final pair
перепрогнано. Failed scratch evidence не є acceptance. Full `make verify` не
запускався; suites різних рівнів не складаються в єдине число.

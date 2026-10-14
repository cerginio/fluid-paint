# QA: Fluid PWA

## Локальний запуск

Фаза 1 **прийнята власником** 2026-10-14 (`handoff:next`), закрита.
Production deploy не виконано; сценарії лишаються регресійними.
Команди для Windows Git Bash, з кореня `D:/work/fluid-paint/fluid-paint`:

```sh
npm run build
npm run test:pwa-assets
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
```

Вона сама піднімає й зупиняє gulp server, перевіряє звільнення порту, записує
`result.json`, HAR, trace, server log і шість PNG **поза repo** в унікальний
каталог `%LOCALAPPDATA%/Temp/fluid-pwa/phase1-…`. Без `PWA_QA_PORT` бере вільний
динамічний порт. На цьому checkout Playwright/Chromium вже доступні.

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

- Фаза не додає SW, precache, offline readiness, install/update UX, hashing,
  hosting headers чи deployment. Manifest — assets groundwork, не offline acceptance.
- Android/iOS standalone, фізичні пристрої та offline cold start — NOT TESTED,
  це майбутні фази. Ширина 320px — desktop Chromium viewport, не телефон.
- Відкриття + ініціює чинний запит Demo index до CDN (2 запити у пробі).
  Це optional app data, не HTML/CSS/manifest dependency; CORS/demo playback
  та доступність зовнішнього каталогу не приймаються цією фазою.
- На mobile story panel накладається на основну й має прозорий фон; це чинний
  layout. Geometry і fonts перевірено, новий UX тут не реалізовано.
- Зовнішні footer anchors прибрані задля буквального guard «0 cross-origin
  HTML links»; attribution-текст незмінний, URLs збережені в assets/PROVENANCE.md.
- Icon master owner-directed; нової ліцензії на чужий арт не вигадано.

## Журнал фаз

- 2026-10-14 — фаза 1 прийнята власником (`handoff:next`) і закрита;
  closing build PASS, guard 7 passed / 0 failed. Browser evidence вище
  збережено; фізичні Android/iOS NOT TESTED. Deploy не виконано.
  Далі фаза 2; фази 2–10 не починались.

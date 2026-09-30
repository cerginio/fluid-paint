# QA: Fluid Paint — публічні демо з R2

Для локальної проби з кореня Fluid Paint після `make install` запустити
`make demo-qa-server`. Відкрити URL нижче у браузері.
Проба використовує контрольовані JSON-відповіді; інтернет і R2 не потрібні.
Після перевірки зупинити сервер через Ctrl+C.

## Фаза 1 — catalog client і preflight

**Рев'ю:** QA-1A і QA-1B пройдені власником 2026-09-30.

### QA-1A. Валідний каталог і модель

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-catalog-probe.html`.
**Клікнути:** `Run valid catalog`.
**Дивитись:** рядок під кнопками.
**Очікуваний результат:** `1 demo; 8 frames; 1 drawable; 2 requests`.
Перевірено автоматизованою браузерною пробою 2026-09-30; людина може
перевірити видимий результат.

### QA-1B. Обмеження потоку до JSON.parse

**Відкрити:** `http://127.0.0.1:3000/debug/story-demo-catalog-probe.html`.
**Клікнути:** `Run oversized response`.
**Дивитись:** рядок під кнопками.
**Очікуваний результат:** `Rejected oversized index: Demo response exceeds the 131072 byte limit.`
Перевірено автоматизованою браузерною пробою 2026-09-30.

## Ще не реалізовано

- Вкладка Demo, preset gating і запуск Player — фаза 2.
- Публічні файли, CORS та live перевірка CDN — фаза 3.

# PWA UI icons — Dazzle UI / SVG Repo

Nine actual SVGs downloaded from SVG Repo, retained verbatim beside this file.
Collection: https://www.svgrepo.com/collection/dazzle-line-icons/
Creator: **Dazzle UI** (https://www.svgrepo.com/author/Dazzle%20UI/).
License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**:
https://creativecommons.org/licenses/by/4.0/ — legal text:
https://creativecommons.org/licenses/by/4.0/legalcode.en . No endorsement implied.

`sources.json` records every original page, exact download URL and SHA-256.
SVG Repo HTML pages were Vercel-blocked during retrieval; direct SVG Repo `/show/`
SVG downloads succeeded. Metadata/creator/license cross-check: the Dazzle UI
section of the SVG Repo attribution mirror at
https://huggingface.co/datasets/nyuuzyou/svgrepo/blob/main/ATTRIBUTION/CC_Attribution_Attribution.md
(CC BY 4.0 heading), corroborated by indexed Dazzle Line icon metadata at
https://viconic.dev/icon/dazzle-line-icons/circle-information . The latter is
metadata only, not the SVG byte source. Do not infer CC0 from other mirrors.

| Shape | UI use | SVG Repo page |
| --- | --- | --- |
| cloud | Preparing offline | https://www.svgrepo.com/svg/532033/cloud |
| cloud-slash | Unavailable/offline preparation | https://www.svgrepo.com/svg/532857/cloud-slash |
| circle-check | Ready / verify | https://www.svgrepo.com/svg/532160/circle-check |
| refresh-cw-alt-3 | Check updates | https://www.svgrepo.com/svg/533704/refresh-cw-alt-3 |
| clock | Later | https://www.svgrepo.com/svg/532098/clock |
| arrow-up | Update | https://www.svgrepo.com/svg/533632/arrow-up |
| download | Install app | https://www.svgrepo.com/svg/533682/download |
| circle-information | Details & install | https://www.svgrepo.com/svg/533722/circle-information |
| chevron-down | Disclosure | https://www.svgrepo.com/svg/533653/chevron-down |

Adaptations: `python debug/generate-pwa-ui-icons.py` parses the retained SVGs as
XML; allows only inert path/geometry elements and presentation/geometry attributes;
removes XML/comments/root dimensions and substitutes black with `currentColor`.
It emits `app/pwa-ui-icons.js`, bundled locally without network dependencies.
All use the original 24×24 viewBox, 2px rounded line style and 22px rendered size.
No external SVG is executed or loaded into the application DOM. Buttons keep
English accessible names; SVGs are aria-hidden/nonfocusable. Disclosure and
status always have text, not color-only meanings. Credit and license URL are
also visible as selectable text in the application's Details & install section.
Owner app icon PNG artwork is unrelated and unchanged.

# Tilecraft Fluid embedded vendor manifest

This repository vendors one indivisible Tilecraft protocol set:

| Fluid Paint path | Tilecraft source at commit 9fcbc5f |
| --- | --- |
| vendor/tilecraft/message-api.js | tilecraft/lib/message-api.js |
| vendor/tilecraft/fluid-model.js | tilecraft/lib/fluid-model.js |
| vendor/tilecraft/fluid-gamifier-bridge.js | tilecraft/lib/fluid-gamifier-bridge.js |

The Fluid Paint integration worktree started at commit df640cf; vendor was
added in Fluid Paint commit e35f086. Do not update one of these files
independently. The protocol version on both endpoints is fluid-paint-v1.

## Exact editor origins

The embedder must supply its exact origin in the iframe URL as
?editorOrigin=https://... . It is never inferred or widened.

| Environment | Tilecraft editor origin |
| --- | --- |
| Development | https://dev.storytilecraft.space |
| Preview | https://preview.storytilecraft.space |
| Production | https://storytilecraft.space |

The deployed Fluid Paint iframe origins are deployment-owned and must be added
here before each environment is enabled; do not substitute a wildcard.

## Bootstrap and acceptance

index.html loads the vendor files in transport -> model -> bridge order. In an
iframe, app/fluid-embed-bootstrap.js builds createFluidEmbeddedClient() with
the real StoryPlaybackController, TilecraftStrokePlayer.compile, and the shared
PNG aspect-fit/white-letterbox decoder. Decoding stages a canvas; it does not
alter the live renderer until the complete transfer validates.

Before closing the external integration gate, run a real editor-to-iframe
compile and Gate 2F for both asset orders, a rotated frame, PNG dimensions,
supersession, and a manual F12 session.

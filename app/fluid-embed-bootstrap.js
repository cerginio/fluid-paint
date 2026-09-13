(function () {
  'use strict';

  const EMBED_ORIGIN_PARAM = 'editorOrigin';

  async function startFluidEmbed() {
    if (window.parent === window) return null;
    const editorOrigin = new URLSearchParams(window.location.search).get(EMBED_ORIGIN_PARAM);
    if (!editorOrigin) {
      console.warn('Fluid embedded mode needs an exact ?editorOrigin=https://… parameter.');
      return null;
    }
    const painter = window.__painter;
    if (!painter?.storyPlaybackController) {
      throw new Error('Fluid Paint controller is not ready for embedded mode.');
    }
    const embedded = await createFluidEmbeddedClient({
      createMessageApi,
      editorOrigin,
      controller: painter.storyPlaybackController,
      compileModel: TilecraftStrokePlayer.compile,
      decodeBackground: (blob, name, meta) => painter.decodeBackground(blob, name, meta),
    });
    window.__fluidEmbeddedClient = embedded;
    window.requestTilecraftFluidScene = (options) => embedded.client.requestScene(options);
    return embedded;
  }

  window.startFluidEmbed = startFluidEmbed;
})();

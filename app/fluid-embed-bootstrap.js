(function () {
  'use strict';

  const EMBED_ORIGIN_PARAM = 'editorOrigin';

  async function waitForEmbedReadiness(timeoutMs = 8000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const painter = window.__painter;
      if (painter?.engine && painter.paintingRectangle) return painter;
      await new Promise(requestAnimationFrame);
    }
    throw new Error('Fluid Paint renderer did not become ready for embedded mode.');
  }

  async function startFluidEmbed() {
    if (window.parent === window) return null;
    const editorOrigin = new URLSearchParams(window.location.search).get(EMBED_ORIGIN_PARAM);
    if (!editorOrigin) {
      console.warn('Fluid embedded mode needs an exact ?editorOrigin=https://… parameter.');
      return null;
    }
    const painter = await waitForEmbedReadiness();
    const controller = painter?.storyPlaybackController || (
      typeof window.StoryPlaybackController === 'function'
        ? new window.StoryPlaybackController(painter)
        : null
    );
    if (!controller) {
      throw new Error('Fluid Paint controller is not ready for embedded mode.');
    }
    if (!painter.storyPlaybackController) painter.storyPlaybackController = controller;
    const embedded = await createFluidEmbeddedClient({
      createMessageApi,
      editorOrigin,
      controller,
      compileModel: TilecraftStrokePlayer.compile,
      decodeBackground: (blob, name, meta) => painter.decodeBackground(blob, name, meta),
    });
    window.__fluidEmbeddedClient = embedded;
    window.requestTilecraftFluidScene = (options) => embedded.client.requestScene(options);
    return embedded;
  }

  window.startFluidEmbed = startFluidEmbed;
})();

/* Included by Gulp only in production bundles; never loaded by source HTML. */
(function () {
  'use strict';
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', {scope:'/', updateViaCache:'none'}).catch(function (error) {
    console.warn('Fluid offline shell install unavailable:', error);
  });
}());

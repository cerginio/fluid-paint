/* eslint-disable no-undef */
const { src, dest, series, parallel, watch } = require('gulp');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');

const plumber = require('gulp-plumber');
const concat = require('gulp-concat');
const terser = require('gulp-terser');
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const replace = require('gulp-replace');
const htmlmin = require('gulp-html-minifier-terser');

const isProd = process.env.NODE_ENV === 'production';

const paths = {
  src: '.',
  dist: 'dist',
  // Phase 7: the stylesheet is app/layout.css and it is copied WITH its
  // directory (see styles(), which passes `base`), because index.html links it
  // as app/layout.css. Copying it flat to dist/layout.css would 404 in the
  // built output while working perfectly from source -- a break only the dist
  // golden run would catch.
  css: ['app/layout.css'],
  // Order matters because the project uses globals (no module system).
  // Adjust if you add/remove files.
  js: [
    // Seeded RNG must load before anything that draws, so Brush's constructor
    // sees it. Inert unless ?seed= is present.
    'debug/deterministic-rng.js',
    // device-emulation harness must load before wrappedgl.js
    'fluid-engine/gl/glsl3.js',
    'debug/debug-flags.js',
    'debug/painting-rect-overlay.js',
    'debug/gpu-profiles.js',
    'debug/texture-selftest.js',
    'debug/device-diag.js',
    // Golden-image harness. Inert unless ?golden= is present; included so the
    // production bundle can be verified the same way the sources are.
    'debug/golden-harness.js',
    'common.js',
    'debug.js',
    'fluid-engine/gl/wrappedgl.js',
    'utilities.js',
    'rectangle.js',
    'viewport.js',
    'fluid-engine/brush.js',
    'fluid-engine/simulation.js',
    'fluid-engine/renderer.js',
    // The facade: must load after the three modules it composes.
    'fluid-engine/index.js',
    // iro.js before app/ui/color.js, which constructs an iro.ColorPicker.
    // Vendored verbatim, MPL-2.0 -- see docs/UI-COMPONENTS.md. colorpicker.js
    // and its two GL programs are gone (Phase 8).
    'lib/iro.js',
    'app/ui/color.js',
    'app/ui/sliders.js',
    'app/ui/buttons.js',
    'brushviewer.js',
    // Vendored from tilecraft with one local patch; see docs/UI-COMPONENTS.md.
    // Reports Y-down CSS-relative coords, so paint.js adapts them via viewport.
    'app/ui/pointer-dispatcher.js',
    // The floating tool panel (Phase 7). After the dispatcher, before paint.js.
    'app/ui/panel.js',
    'paint-setup.js',
    'paint.js'

  ],
  // Two shader trees since Phase 4. Each is copied to the same relative place
  // in dist as it sits in the source, because the base paths in common.js are
  // literal fetch prefixes -- a flattened dist would 404 every request.
  engineShaders: 'fluid-engine/shaders/**/*.{glsl,frag,vert}',
  appShaders: 'app/shaders/**/*.{glsl,frag,vert}',
  html: 'index.html',
  static: ['LICENSE']
};

// Clean dist using Node's fs.rm so we avoid extra deps
async function clean() {
  await fs.rm(paths.dist, { recursive: true, force: true });
}

// ---------- SCRIPTS ----------
function scripts() {
  return src(paths.js, { allowEmpty: true })
    .pipe(plumber())
    .pipe(concat('bundle.js', { newLine: ';\n' }))
    .pipe(terser({
      compress: isProd,
      mangle: isProd,
      keep_fnames: !isProd
    }))
    .pipe(dest(paths.dist));
}

// ---------- STYLES ----------
function styles() {
  // `base: '.'` keeps app/ in the output path; without it gulp flattens the
  // file to the root of dist/ and the <link href="app/layout.css"> breaks.
  return src(paths.css, { allowEmpty: true, base: '.' })
    .pipe(plumber())
    .pipe(postcss([
      autoprefixer(),
      ...(isProd ? [cssnano()] : [])
    ]))
    .pipe(dest(paths.dist));
}

// ---------- SHADERS ----------
// Mirror the source layout. The engine tree moved under fluid-engine/ in Phase
// 3 and the chrome tree split off into app/ in Phase 4; the base paths in
// common.js point at both, so dist has to match or every fetch 404s.
function engineShaders() {
  return src(paths.engineShaders, { allowEmpty: true })
    .pipe(dest(path.join(paths.dist, 'fluid-engine', 'shaders')));
}

function appShaders() {
  return src(paths.appShaders, { allowEmpty: true })
    .pipe(dest(path.join(paths.dist, 'app', 'shaders')));
}

const shaders = parallel(engineShaders, appShaders);

// ---------- HTML ----------
// Remove all local <script src="*.js"> tags and inject a single bundle.js.
// Also minify in production.
function html() {
  let stream = src(paths.html, { allowEmpty: true })
    .pipe(plumber())

    // 1) Remove existing bundle reference (idempotent)
    .pipe(replace(
      /[\t ]*<script\b[^>]*\bsrc=["']bundle\.js["'][^>]*>\s*<\/script>\s*/gi,
      ''
    ))

    // 2) Remove ALL local .js script tags (not http(s) or protocol-relative)
    //    Works with CRLF/LF, extra attributes, different spacing.
    .pipe(replace(
      /[\t ]*<script\b[^>]*\bsrc=["'](?!https?:|\/\/)[^"']+\.js["'][^>]*>\s*<\/script>\s*/gi,
      ''
    ))

    // 3) Inject our bundle once, right before </body>
    .pipe(replace(
      /<\/body>/i,
      '  <script src="bundle.js"></script>\n</body>'
    ));

  if (isProd) {
    stream = stream.pipe(htmlmin({
      collapseWhitespace: true,
      removeComments: true,
      minifyJS: true,
      minifyCSS: true
    }));
  }

  return stream.pipe(dest(paths.dist));
}

// ---------- STATIC (optional) ----------
function staticFiles() {
  return src(paths.static, { allowEmpty: true })
    .pipe(dest(paths.dist));
}

// examples/ is deliberately NOT built into dist/, and that is a decision rather
// than an omission (Phase 9).
//
// examples/minimal/ loads the engine as SEPARATE SOURCE FILES -- four <script>
// tags at ../../fluid-engine/*.js -- because its whole purpose is to show what a
// host must pull in to run the engine, and a single bundle.js hides exactly
// that. dist/ has no such files: scripts() concatenates everything into one
// bundle. So copying the example into dist/ would ship a page that 404s four
// times and renders nothing, which is worse than not shipping it.
//
// The example is run from source (`npm run dev`, then
// /examples/minimal/index.html) and is verified there by debug/phase9-probe.js,
// which serves the repo root rather than dist. If a bundled example is ever
// wanted, it needs its own concat target -- not a copy of this directory.

// ---------- SERVE ----------
function startServer(done) {
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.frag': 'text/plain; charset=utf-8',
    '.vert': 'text/plain; charset=utf-8'
  };
  const root = path.resolve(paths.dist);

  http.createServer(async (request, response) => {
    const requestPath = new URL(request.url, 'http://localhost').pathname;
    const relativePath = decodeURIComponent(requestPath === '/' ? '/index.html' : requestPath)
      .replace(/^[/\\]+/, '');
    const filePath = path.resolve(root, relativePath);

    if (!filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const file = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream'
      }).end(file);
    } catch {
      response.writeHead(404).end('Not found');
    }
  }).listen(3000, () => {
    console.log('Development server running at http://localhost:3000');
    done();
  });

  watch(paths.html, html);
  watch(paths.css, styles);
  watch(paths.engineShaders, engineShaders);
  watch(paths.appShaders, appShaders);
  watch(paths.js, scripts);
}

const build = series(
  clean,
  parallel(html, styles, shaders, scripts, staticFiles)
);

exports.clean = clean;
exports.scripts = scripts;
exports.styles = styles;
exports.shaders = shaders;
exports.html = html;
exports.build = build;
exports.serve = series(build, startServer);
exports.dev = series(build, startServer);
exports.default = build;

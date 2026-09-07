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
  // Keep CSS filename the same so we don't need to rewrite <link> href
  css: ['paint.css'],
  // Order matters because the project uses globals (no module system).
  // Adjust if you add/remove files.
  js: [
    // Seeded RNG must load before anything that draws, so Brush's constructor
    // sees it. Inert unless ?seed= is present.
    'debug/deterministic-rng.js',
    // device-emulation harness must load before wrappedgl.js
    'glsl3.js',
    'debug/debug-flags.js',
    'debug/gpu-profiles.js',
    'debug/texture-selftest.js',
    'debug/device-diag.js',
    // Golden-image harness. Inert unless ?golden= is present; included so the
    // production bundle can be verified the same way the sources are.
    'debug/golden-harness.js',
    'common.js',
    'debug.js',
    'wrappedgl.js',
    'utilities.js',
    'rectangle.js',
    'brush.js',
    'simulator.js',
    'colorpicker.js',
    'slider.js',
    'buttons.js',
    'brushviewer.js',
    'paint-setup.js',
    'paint.js'

  ],
  shaders: 'shaders/**/*.{glsl,frag,vert}',
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
  return src(paths.css, { allowEmpty: true })
    .pipe(plumber())
    .pipe(postcss([
      autoprefixer(),
      ...(isProd ? [cssnano()] : [])
    ]))
    .pipe(dest(paths.dist));
}

// ---------- SHADERS ----------
function shaders() {
  return src(paths.shaders, { allowEmpty: true })
    .pipe(dest(path.join(paths.dist, 'shaders')));
}

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
  watch(paths.shaders, shaders);
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

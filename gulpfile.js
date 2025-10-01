/* eslint-disable no-undef */
const { src, dest, series, parallel, watch } = require('gulp');
const fs = require('fs/promises');
const path = require('path');

const plumber = require('gulp-plumber');
const sourcemaps = require('gulp-sourcemaps');
const concat = require('gulp-concat');
const order = require('gulp-order');
const terser = require('gulp-terser');
const postcss = require('gulp-postcss');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');
const replace = require('gulp-replace');
const htmlmin = require('gulp-htmlmin');
const gulpIf = require('gulp-if');
const browserSync = require('browser-sync').create();

const isProd = false;// process.env.NODE_ENV === 'production';

const paths = {
  src: '.',
  dist: 'dist',
  // Keep CSS filename the same so we don't need to rewrite <link> href
  css: ['paint.css'],
  // Order matters because the project uses globals (no module system).
  // Adjust if you add/remove files.
  js: [
    'common.js',           // utility helpers (present in your zip)
    // If you actually have wrappedgl.js/utilities.js, include them here:
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
    .pipe(sourcemaps.init())
    .pipe(order(paths.js, { base: './' }))
    .pipe(concat('bundle.js', { newLine: ';\n' }))
    .pipe(terser({
      compress: isProd,
      mangle: isProd,
      keep_fnames: !isProd
    }))
    .pipe(sourcemaps.write('.', { includeContent: false, sourceRoot: '/' }))
    .pipe(dest(paths.dist))
    .pipe(browserSync.stream({ match: '**/*.js' }));
}

// ---------- STYLES ----------
function styles() {
  return src(paths.css, { allowEmpty: true })
    .pipe(plumber())
    .pipe(sourcemaps.init())
    .pipe(postcss([
      autoprefixer(),
      cssnano()
    ]))
    .pipe(sourcemaps.write('.'))
    .pipe(dest(paths.dist))
    .pipe(browserSync.stream({ match: '**/*.css' }));
}

// ---------- SHADERS ----------
function shaders() {
  return src(paths.shaders, { allowEmpty: true })
    .pipe(dest(path.join(paths.dist, 'shaders')))
    .pipe(browserSync.stream({ match: '**/*' }));
}

// ---------- HTML ----------
// Remove all local <script src="*.js"> tags and inject a single bundle.js.
// Also minify in production.
function html() {
  return src(paths.html, { allowEmpty: true })
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
    ))

    .pipe(gulpIf(isProd, htmlmin({
      collapseWhitespace: true,
      removeComments: true,
      minifyJS: true,
      minifyCSS: true
    })))
    .pipe(dest(paths.dist))
    .pipe(browserSync.stream({ match: '**/*.html' }));
}

// ---------- STATIC (optional) ----------
function staticFiles() {
  return src(paths.static, { allowEmpty: true })
    .pipe(dest(paths.dist));
}

// ---------- DEV COPY ----------
function dev() {
  return src([
    '**/*',
    '!node_modules/**',
    '!dist/**',
    '!.git/**',
    '!**/*.md',
    '!LICENSE',
    '!.gitignore',
    '!package*',
    '!LICENSE.*',
    '!gulpfile.js',

  ], { dot: true })
    .pipe(dest(paths.dist));
}

// ---------- SERVE ----------
function serve() {
  browserSync.init({
    server: { baseDir: paths.dist },
    open: false,
    notify: false
  });

  // initial build
  const initial = parallel(html, styles, shaders, scripts);
  initial(() => { });

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
exports.serve = serve;
exports.dev = dev;
exports.default = build;

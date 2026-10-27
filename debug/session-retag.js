'use strict';

// Rewrite a .flus as if another engine had recorded it -- for checking the
// Vector replay (fluid-session phase 5, AC-REC-9) by hand and in the UI test.
//
//   npm run session:retag -- <in.flus> <out.flus> [--engine-contract N] [--strip-keyframes]
//
// --engine-contract defaults to this engine's contract + 1. --strip-keyframes
// drops section C, which a file of another engine then cannot be played without.
// Prints the file's keyframe statistics as JSON.
const fs = require('node:fs');
const SessionCodec = require('../app/session-codec.js');
const SessionRecorder = require('../app/session-recorder.js');

async function retag(bytes, { engineContract = SessionRecorder.ENGINE_CONTRACT + 1, stripKeyframes = false } = {}) {
  const session = await SessionCodec.decode(bytes);
  const stats = {
    ticks: session.header.stats ? session.header.stats.ticks : null,
    strokes: session.keyframes ? session.keyframes.strokes.length : 0,
    keyframes: session.keyframes ? session.keyframes.strokes.reduce((sum, stroke) => sum + stroke.t.length, 0) : 0,
  };
  session.header = { ...session.header, engineContract };
  if (stripKeyframes) session.keyframes = null;
  return { bytes: Buffer.from(await SessionCodec.encode(session)), stats };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const files = args.filter((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
  const contractIndex = args.indexOf('--engine-contract');
  if (files.length !== 2) {
    console.error('usage: node debug/session-retag.js <in.flus> <out.flus> [--engine-contract N] [--strip-keyframes]');
    process.exit(2);
  }
  const options = { stripKeyframes: args.includes('--strip-keyframes') };
  if (contractIndex >= 0) options.engineContract = Number(args[contractIndex + 1]);
  retag(fs.readFileSync(files[0]), options).then(({ bytes, stats }) => {
    fs.writeFileSync(files[1], bytes);
    const keyframes = options.stripKeyframes ? 0 : stats.keyframes;
    console.log(JSON.stringify({ out: files[1], engineContract: options.engineContract ?? SessionRecorder.ENGINE_CONTRACT + 1,
      keyframes, ticks: stats.ticks,
      ticksPerKeyframe: keyframes ? Math.round(stats.ticks / keyframes * 100) / 100 : null }));
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { retag };

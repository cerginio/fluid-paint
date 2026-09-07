'use strict';

/*
 * A single-runner lock for anything that launches Playwright.
 *
 * Why this exists. Each headless Chromium here costs ~300-800 MB and pins a
 * core; the golden run drives 12 scenarios through one browser, which is fine
 * on its own. What is NOT fine is two or three of those running at once --
 * measured on this machine: 12 chrome-headless-shell processes, 91% CPU, and
 * the mouse freezing for seconds at a time. That happened because runs were
 * started in the background and a second one was launched before the first
 * finished.
 *
 * The fix belongs in the code rather than in a habit: a run that would be the
 * second one refuses to start and says so. Being told "another run is already
 * going" is always better than silently making the machine unusable and then
 * comparing hashes produced under CPU starvation.
 *
 * The lock stores a pid, so a crashed run cannot wedge the next one -- a stale
 * lock whose process is gone is simply taken over.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_FILE = path.join(os.tmpdir(), 'fluid-paint-playwright.lock');

function isAlive(pid) {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else -- still alive.
    return err.code === 'EPERM';
  }
}

/**
 * Take the lock, or exit with a clear message.
 *
 * @param {string} label  what is running, for the message the next caller sees
 */
function acquireBrowserLock(label) {
  if (fs.existsSync(LOCK_FILE)) {
    let held = null;
    try {
      held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    } catch (e) {
      held = null; // unreadable lock is treated as stale
    }

    if (held && held.pid && isAlive(held.pid)) {
      console.error(
        `\nAnother Playwright run is already going: ${held.label} (pid ${held.pid}).\n` +
        'Running two at once saturates the CPU -- 12 headless Chromium processes\n' +
        'were measured doing exactly that. Wait for it to finish, or kill it:\n' +
        `  taskkill /F /PID ${held.pid} /T\n`
      );
      process.exit(2);
    }
    // Stale: the holder is gone, so the lock is ours to take.
  }

  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, label, at: Date.now() }));

  const release = () => {
    try {
      const held = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      // Only remove OUR lock -- never one a later run has since taken.
      if (held.pid === process.pid) fs.unlinkSync(LOCK_FILE);
    } catch (e) { /* already gone */ }
  };

  process.on('exit', release);
  // Ctrl+C and kill must release too, or the next run sees a stale lock and has
  // to reason about it. SIGINT/SIGTERM do not run 'exit' handlers by default.
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });

  return release;
}

module.exports = { acquireBrowserLock };

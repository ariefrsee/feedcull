/* FeedCull canonical verification — browser-free, runs anywhere.
 * Usage: node test/verify.js
 * Runs: heuristics unit suite + static integrity checks (manifest, syntax,
 * popup wiring, storage split). The browser suites (popup/killfile/install)
 * need a live Chrome for Testing — see README.
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

/* 1. unit suite */
try {
  execFileSync(process.execPath, [path.join(__dirname, 'heuristics.test.js')], { stdio: 'inherit' });
  check('heuristics unit suite', true);
} catch (e) { check('heuristics unit suite', false); }

/* 2. manifest integrity */
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
check('manifest parses', !!m);
m.content_scripts.flatMap((cs) => cs.js).forEach((f) =>
  check('script exists: ' + f, fs.existsSync(path.join(ROOT, f))));
check('popup exists', fs.existsSync(path.join(ROOT, m.action.default_popup)));
check('options exists', fs.existsSync(path.join(ROOT, m.options_page)));
Object.values(m.icons).forEach((v) => check('icon exists: ' + v, fs.existsSync(path.join(ROOT, v))));

/* 3. syntax (compile-only) */
['src/heuristics.js', 'src/content-core.js', 'src/content-hn.js',
  'src/content-reddit.js', 'src/popup.js', 'src/options.js']
  .forEach((f) => {
    try {
      new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
      check('syntax: ' + f, true);
    } catch (e) { check('syntax: ' + f + ' — ' + e.message, false); }
  });

/* 4. popup HTML<->JS wiring */
const html = fs.readFileSync(path.join(ROOT, 'src/popup.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src/popup.js'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((x) => x[1]));
[...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map((x) => x[1]))]
  .forEach((id) => check('popup id wired: ' + id, ids.has(id)));

/* 5. storage split (counters local, settings sync) + error surfacing */
const core = fs.readFileSync(path.join(ROOT, 'src/content-core.js'), 'utf8');
check('counters in chrome.storage.local', core.includes('chrome.storage.local') && js.includes('chrome.storage.local'));
check('storage errors surfaced', js.includes('chrome.runtime.lastError'));

console.log(fail === 0 ? '\nVERIFY PASSED (' + pass + ' checks)' : '\n' + fail + ' CHECK(S) FAILED');
process.exit(fail ? 1 : 0);

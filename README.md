# FeedCull — v1 scaffold (product of Omni-Corp OS, SaaS Factory)

For readers drowning in low-effort AI content: a browser extension that puts
feed curation back in user hands. Killfiles, author/domain reputation, topic
filters, optional heuristic flags. NOT an AI detector — no verdicts, no false
accusations; the user always holds the lever.

## Status (2026-08-04)
- Engine: unit-tested (node test/heuristics.test.js — all pass)
- Extension: MV3 scaffold complete — HN + Reddit adapters, popup, options
- Landing page: products/feedcull/landing/index.html (waitlist form, local v1)
- NOT YET: manual browser install test (human CEO), Chrome Web Store packaging,
  LLM-judge (phase 2), cross-device sync (phase 2)

## Install for testing (10 min, human CEO)
1. Open chrome://extensions
2. Enable "Developer mode" (top-right)
3. Click "Load unpacked" and select this directory (products/feedcull)
4. Open news.ycombinator.com — FeedCull is live. Click the icon for controls.

## Automated install test (scripted, repeatable)
Chrome 137+ removed the --load-extension flag on branded builds, so the
scripted path uses Chrome for Testing (CfT), which keeps it:

1. Download CfT (https://googlechromelabs.github.io/chrome-for-testing/),
   platform mac-arm64 (or your arch).
2. Launch with the extension + CDP:
     "Google Chrome for Testing" --user-data-dir=/tmp/feedcull-test-profile \
       --load-extension=<this dir> --remote-debugging-port=9222 \
       --new-window https://news.ycombinator.com
3. Run the harness:  node test/install-test.js
   It verifies: content-script world injected -> filters written to
   chrome.storage.sync from the extension context -> reload -> matching
   HN rows culled (with real counts and titles).
4. Expect "INSTALL TEST PASSED".

## Tests
- Browser-free canonical suite:  node test/verify.js
  (heuristics units + manifest/syntax/popup-wiring/storage-split integrity)
- Browser suites (need CfT running, see above):
  node test/install-test.js        injection -> filters -> culling on HN
  node test/popup-test.js          killfile add/remove in the real popup
  node test/killfile-e2e-test.js   killfile entry -> posts culled after reload
  node test/reddit-test.js         reddit adapters via DOM fixtures (both branches):
     FC_EXT_DIR=test/load-dir node test/reddit-test.js \
       https://old.reddit.com:8891/test/fixtures/old-reddit.html
     (CfT must run with --host-resolver-rules="MAP old.reddit.com 127.0.0.1, MAP www.reddit.com 127.0.0.1"
      --ignore-certificate-errors, plus the local HTTPS server from /tmp/https-serve.js.
      Live reddit blocks automation, so fixtures stand in for its DOM.)
     If you change src/, re-sync the test build: cp -r src test/load-dir/src
  node test/waitlist-test.js       landing waitlist: endpoint POST, honeypot, fallback

## Structure
  manifest.json          MV3 manifest
  src/heuristics.js      pure scoring engine (unit-tested, no browser APIs)
  src/content-core.js    settings + decision pipeline (killfile > heuristic)
  src/content-hn.js      Hacker News adapter
  src/content-reddit.js  Reddit adapter (new + old reddit)
  src/popup.html/.js     per-site toggle, sensitivity, KILLFILES (add/remove
                         domains & authors right in the popup), reload-tab
  src/options.html/.js   killfiles (domains/authors), topic filters
  icons/                 generated (scripts/gen_icons.py)
  landing/index.html     marketing page + waitlist
  test/                  engine unit tests

## Honest scope notes
- HN has no article body in the DOM: v1 scores titles only (conservative).
  Article-text judging ships with the phase-2 LLM-judge.
- Reddit's feed DOM changes often; adapters target shreddit-post (new),
  .thing (old), and post-container fallbacks.
- Browser behavior is verified by the human CEO in the install test above;
  the engine itself is verified by unit tests.

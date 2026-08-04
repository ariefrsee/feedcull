/* FeedCull popup UI test — opens the real action popup in CfT and drives it
 * via CDP: add domain killfile, add author killfile, remove one, verify
 * chrome.storage + the rendered list after each step.
 *
 * Usage: CfT running with extension + CDP on 9222 -> node test/popup-test.js
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

const CDP = 'http://127.0.0.1:9222';
const EXT_PATH = require('path').resolve(__dirname, '..');

function extIdFromPath(p) {
  const d = crypto.createHash('sha256').update(p).digest();
  const alpha = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 16; i++) id += alpha[d[i] >> 4] + alpha[d[i] & 0xF];
  return id;
}

function req(method, path) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9222, path, method }, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res(JSON.parse(d || '{}')));
    });
    r.on('error', rej);
    r.end();
  });
}

function attach(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => res({
      send(method, params = {}) {
        return new Promise((r, j) => {
          const i = ++id;
          pending.set(i, r);
          ws.send(JSON.stringify({ id: i, method, params }));
        });
      },
      close() { ws.close(); }
    });
    ws.onerror = rej;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
  });
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
  if (r.result && r.result.exceptionDetails) {
    throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
  }
  return r.result.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(urlPart, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const list = await req('GET', '/json');
    const hit = list.find((t) => t.url.includes(urlPart));
    if (hit) return hit;
    await sleep(400);
  }
  throw new Error('timeout waiting for target ' + urlPart);
}

(async () => {
  const extId = extIdFromPath(EXT_PATH);
  console.log('FeedCull extension ID :', extId);

  /* 1. wake the service worker (content-script world ping) */
  const hn = await waitForTarget('news.ycombinator.com');
  const page = await attach(hn.webSocketDebuggerUrl);
  const contexts = [];
  page._evt = (m) => { if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context); };
  /* patch attach to forward events */
  page.send('Runtime.enable').catch(() => {});
  await page.send('Page.reload');
  await sleep(3000);
  /* NOTE: event forwarding is set after enable; do a manual probe instead */
  const probe = await evaluate(page, `(() => {
    const rows = [...document.querySelectorAll('tr.athing')];
    return { rows: rows.length };
  })()`);
  console.log('HN page alive          :', JSON.stringify(probe));

  /* 2. try to open the action popup from an extension context */
  const list = await req('GET', '/json');
  const sw = list.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  if (sw) {
    const worker = await attach(sw.webSocketDebuggerUrl);
    try {
      await evaluate(worker, `chrome.action.openPopup()`);
      console.log('Popup opened via service worker');
    } catch (e) {
      console.log('openPopup from worker failed:', e.message);
    }
    worker.close();
  } else {
    console.log('No service worker target; popup must be opened via the toolbar click.');
  }

  /* 3. find the popup target */
  let popup;
  try {
    popup = await waitForTarget(`chrome-extension://${extId}/src/popup.html`, 6000);
    console.log('Popup target found     :', popup.url);
  } catch (e) {
    console.log('Popup not open. Open it by clicking the extension icon in the CfT toolbar, then re-run.');
    process.exit(2);
  }

  const p = await attach(popup.webSocketDebuggerUrl);
  await sleep(500);

  /* 4. drive the UI: add a domain killfile */
  await evaluate(p, `(() => {
    const input = document.getElementById('newDomain');
    input.value = 'spam.example.com';
    document.getElementById('addDomain').click();
  })()`);
  await sleep(500);
  const afterDomain = await evaluate(p, `(async () => {
    const s = await chrome.storage.sync.get(null);
    const items = [...document.querySelectorAll('#killList li .val')].map(e => e.textContent);
    return { killDomains: s.killDomains, killAuthors: s.killAuthors, listItems: items };
  })()`);
  console.log('After adding domain    :', JSON.stringify(afterDomain));

  /* 5. add an author killfile */
  await evaluate(p, `(() => {
    const input = document.getElementById('newAuthor');
    input.value = 'slop_writer';
    document.getElementById('addAuthor').click();
  })()`);
  await sleep(500);
  const afterAuthor = await evaluate(p, `(async () => {
    const s = await chrome.storage.sync.get(null);
    const items = [...document.querySelectorAll('#killList li .val')].map(e => e.textContent);
    return { killDomains: s.killDomains, killAuthors: s.killAuthors, listItems: items };
  })()`);
  console.log('After adding author    :', JSON.stringify(afterAuthor));

  /* 6. remove the domain entry via its x button */
  await evaluate(p, `(() => {
    const li = [...document.querySelectorAll('#killList li')].find(e => e.textContent.includes('spam.example.com'));
    li.querySelector('.rm').click();
  })()`);
  await sleep(500);
  const afterRemove = await evaluate(p, `(async () => {
    const s = await chrome.storage.sync.get(null);
    const items = [...document.querySelectorAll('#killList li .val')].map(e => e.textContent);
    return { killDomains: s.killDomains, killAuthors: s.killAuthors, listItems: items };
  })()`);
  console.log('After removing domain  :', JSON.stringify(afterRemove));

  /* 7. cleanup + verdict */
  await evaluate(p, `chrome.storage.sync.set({ killDomains: [], killAuthors: [] })`);
  p.close();
  page.close();

  const ok = afterDomain.killDomains.indexOf('spam.example.com') !== -1 &&
             afterDomain.listItems.indexOf('spam.example.com') !== -1 &&
             afterAuthor.killAuthors.indexOf('slop_writer') !== -1 &&
             afterAuthor.listItems.indexOf('slop_writer') !== -1 &&
             afterRemove.killDomains.length === 0 &&
             afterRemove.listItems.indexOf('spam.example.com') === -1;
  console.log('\n' + (ok ? 'POPUP TEST PASSED' : 'POPUP TEST FAILED'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });

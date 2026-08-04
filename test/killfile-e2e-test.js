/* FeedCull killfile end-to-end test — a killfile entry added through the
 * popup must cull matching posts after reload. Reuses the install-test
 * CDP approach. Usage: CfT running + extension loaded -> node test/killfile-e2e-test.js
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const EXT_PATH = path.resolve(__dirname, '..');

function extIdFromPath(p) {
  const d = crypto.createHash('sha256').update(p).digest();
  const alpha = 'abcdefghijklmnop';
  let id = '';
  for (let i = 0; i < 16; i++) id += alpha[d[i] >> 4] + alpha[d[i] & 0xF];
  return id;
}

function req(path) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 9222, path }, (x) => {
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
    const listeners = [];
    ws.onopen = () => res({
      send(method, params = {}) {
        return new Promise((r, j) => {
          const i = ++id;
          pending.set(i, r);
          ws.send(JSON.stringify({ id: i, method, params }));
        });
      },
      onEvent(fn) { listeners.push(fn); },
      close() { ws.close(); }
    });
    ws.onerror = rej;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method) { listeners.forEach((fn) => fn(m)); }
    };
  });
}

async function evaluate(cdp, expression, contextId) {
  const params = { expression, returnByValue: true, awaitPromise: true };
  if (contextId !== undefined) params.contextId = contextId;
  const r = await cdp.send('Runtime.evaluate', params);
  if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
  if (r.result && r.result.exceptionDetails) {
    throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
  }
  return r.result.result.value;
}

async function freshExtContext(cdp, extId) {
  const contexts = [];
  cdp.onEvent((m) => {
    if (m.method === 'Runtime.executionContextCreated') contexts.push(m.params.context);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 3000));
  return contexts.find((c) => (c.origin || '').includes(extId));
}

async function evalInExtContext(cdp, extId, expression) {
  for (let i = 0; i < 6; i++) {
    const ctx = await freshExtContext(cdp, extId);
    if (!ctx) continue;
    try { return await evaluate(cdp, expression, ctx.id); }
    catch (e) { /* context died; retry */ }
  }
  throw new Error('could not evaluate in extension context');
}

(async () => {
  const extId = extIdFromPath(EXT_PATH);
  console.log('FeedCull extension ID :', extId);

  const tabs = await (async () => {
    for (let i = 0; i < 30; i++) {
      const list = await req('/json');
      const t = list.find((x) => x.type === 'page' && x.url.includes('news.ycombinator.com'));
      if (t) return t;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('no HN tab');
  })();
  const cdp = await attach(tabs.webSocketDebuggerUrl);

  /* clean slate */
  await evalInExtContext(cdp, extId, `chrome.storage.sync.clear()`);
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 3500));

  /* baseline */
  const base = await evaluate(cdp, `[...document.querySelectorAll('tr.athing')].filter(r => r.style.display === 'none').length`);
  console.log('Baseline hidden rows  :', base, '(expect 0)');

  /* set a killfile domain exactly as the popup does */
  await evalInExtContext(cdp, extId, `chrome.storage.sync.set({ killDomains: ['arxiv.org'], killAuthors: [], topicKeywords: [] })`);
  console.log('Killfile set          : arxiv.org');
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 4000));

  const result = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('tr.athing')];
    const hidden = rows.filter(r => r.style.display === 'none').map(r => {
      const a = r.querySelector('.titleline a');
      const d = r.querySelector('.sitestr');
      return { title: a ? a.textContent : '', domain: d ? d.textContent : '' };
    });
    return { total: rows.length, hidden: hidden.length, hidden };
  })()`);
  console.log('After killfile reload  :', JSON.stringify(result.hidden));

  await evalInExtContext(cdp, extId, `chrome.storage.sync.clear()`);
  cdp.close();

  const ok = base === 0 &&
             result.hidden.length > 0 &&
             result.hidden.every((h) => (h.domain || '').toLowerCase().includes('arxiv.org'));
  console.log('\n' + (ok ? 'KILLFILE E2E TEST PASSED' : 'KILLFILE E2E TEST FAILED'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });

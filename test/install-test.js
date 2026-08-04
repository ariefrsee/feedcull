/* FeedCull install test v2 — drives a real Chrome via CDP.
 * Usage: Chrome running with --remote-debugging-port=9222 and the
 * extension loaded ->  node test/install-test.js
 *
 * Chain verified: (1) content script world injected on HN (extension
 * loaded), (2) filters written to chrome.storage.sync from the extension
 * context, (3) page reload -> content script culls matching rows.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');

const CDP = 'http://127.0.0.1:9222';
const EXT_PATH = require('path').resolve(__dirname, '..');
const HN = 'https://news.ycombinator.com/';

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

async function waitFor(pred, what, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await pred(); if (v) return v; } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('timeout waiting for ' + what);
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
      _emit(m) { listeners.forEach((fn) => fn(m)); },
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

/* Reload the page and return a fresh extension isolated-world context. */
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

/* Evaluate in the extension world with retry: contexts churn on navigation,
 * so re-capture until one survives long enough for the eval to land. */
async function evalInExtContext(cdp, extId, expression) {
  for (let i = 0; i < 6; i++) {
    const ctx = await freshExtContext(cdp, extId);
    if (!ctx) continue;
    try { return await evaluate(cdp, expression, ctx.id); }
    catch (e) { /* context died; retry with a fresh one */ }
  }
  throw new Error('could not evaluate in extension context after retries');
}

(async () => {
  const extId = extIdFromPath(EXT_PATH);
  console.log('FeedCull extension ID :', extId);

  const tabs = await waitFor(async () => {
    const list = await req('GET', '/json');
    return list.filter((t) => t.type === 'page' && t.url.includes('news.ycombinator.com'));
  }, 'HN tab');
  const hn = await attach(tabs[0].webSocketDebuggerUrl);

  /* --- 1. prove injection: reload and find the extension isolated world --- */
  const extCtx = await freshExtContext(hn, extId);
  if (!extCtx) {
    console.log('FAIL: extension content-script world not found on HN page.');
    process.exit(1);
  }
  console.log('Injection confirmed   : content-script isolated world live (id', extCtx.id + ')');

  /* --- 1b. reset filters so the run is deterministic --- */
  await evalInExtContext(hn, extId, `chrome.storage.sync.clear()`);
  await hn.send('Page.reload');
  await new Promise((r) => setTimeout(r, 3500));

  /* --- baseline --- */
  const baseline = await evaluate(hn, `(() => {
    const rows = [...document.querySelectorAll('tr.athing')];
    return { total: rows.length, hidden: rows.filter(r => r.style.display === 'none').length };
  })()`);
  console.log('Baseline (no filters) :', JSON.stringify(baseline), '(0 hidden expected)');

  /* --- 2. write filters from a fresh extension context (chrome.storage) --- */
  const stored = await evalInExtContext(hn, extId, `(async () => {
    await chrome.storage.sync.set({ topicKeywords: ['ai', 'gpt', 'llm'], sensitivity: 'med' });
    const s = await chrome.storage.sync.get(null);
    return { topicKeywords: s.topicKeywords, sensitivity: s.sensitivity };
  })()`);
  console.log('Filters written       :', JSON.stringify(stored));

  /* --- 3. reload and measure culling --- */
  await hn.send('Page.reload');
  await new Promise((r) => setTimeout(r, 4000));
  const after = await evaluate(hn, `(() => {
    const rows = [...document.querySelectorAll('tr.athing')];
    const hidden = rows.filter(r => r.style.display === 'none');
    return {
      total: rows.length,
      hidden: hidden.length,
      hiddenTitles: hidden.map(r => (r.querySelector('.titleline a') || {}).textContent)
    };
  })()`);
  console.log('After filters         :', JSON.stringify(after, null, 2));

  const ok = after.hidden > 0;
  console.log('\n' + (ok ? 'INSTALL TEST PASSED' : 'INSTALL TEST FAILED (nothing culled)'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });

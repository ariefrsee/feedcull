/* FeedCull Reddit adapter live test — the HN-only gap.
 * Usage: CfT running with extension + CDP on 9222, a reddit tab open
 * (old.reddit.com is most bot-tolerant) -> node test/reddit-test.js
 * Verifies: injection on reddit, topic filters cull matching posts.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
/* FC_EXT_DIR lets you point at a different extension build (e.g. the
 * localhost-permission test build in test/load-dir). */
const EXT_PATH = process.env.FC_EXT_DIR
  ? path.resolve(process.env.FC_EXT_DIR)
  : path.resolve(__dirname, '..');

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
    catch (e) { /* retry */ }
  }
  throw new Error('could not evaluate in extension context');
}

/* count posts: works for old reddit (.thing) and new reddit (shreddit-post) */
const COUNT_EXPR = `(() => {
  const sel = '.thing, shreddit-post, [data-testid="post-container"]';
  const els = [...document.querySelectorAll(sel)];
  const hidden = els.filter(el => el.style.display === 'none');
  const titleOf = el => {
    if (el.tagName === 'SHREDDIT-POST') return el.getAttribute('post-title') || '';
    const t = el.querySelector('a.title, h3');
    return t ? t.textContent : '';
  };
  return { total: els.length, hidden: hidden.length, hiddenTitles: hidden.map(titleOf).slice(0, 8) };
})()`;

(async () => {
  const extId = extIdFromPath(EXT_PATH);
  console.log('FeedCull extension ID :', extId);

  /* find a target tab: explicit URL arg (fixture) or a live reddit tab */
  const TARGET = process.argv[2] || null;
  let tab;
  for (let i = 0; i < 30; i++) {
    const list = await req('/json');
    tab = list.find((t) => t.type === 'page' &&
      (TARGET ? t.url.includes('127.0.0.1') || t.url.includes(TARGET) : t.url.includes('reddit.com')));
    if (tab) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!tab) {
    console.log('FAIL: no reddit tab found. Reddit may be blocking CfT.');
    process.exit(2);
  }
  console.log('Reddit tab            :', tab.url.slice(0, 80));
  const cdp = await attach(tab.webSocketDebuggerUrl);

  /* clean slate */
  await evalInExtContext(cdp, extId, `chrome.storage.sync.clear()`);
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 4000));

  const base = await evaluate(cdp, COUNT_EXPR);
  console.log('Baseline              :', JSON.stringify({ total: base.total, hidden: base.hidden }));

  if (base.total === 0) {
    console.log('SKIP: no posts rendered — Reddit likely blocked the request (login/robot wall).');
    console.log('Page title check:');
    console.log(await evaluate(cdp, 'document.title').catch(() => '(unreadable)'));
    process.exit(3);
  }

  /* set topic filters, reload, measure */
  await evalInExtContext(cdp, extId, `chrome.storage.sync.set({ topicKeywords: ['ai', 'gpt', 'llm'], killDomains: [], killAuthors: [] })`);
  const readback = await evalInExtContext(cdp, extId, `chrome.storage.sync.get(null)`);
  console.log('Storage readback      :', JSON.stringify(readback));
  console.log('Filters set           : topicKeywords [ai, gpt, llm]');
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 4500));

  const after = await evaluate(cdp, COUNT_EXPR);
  console.log('After filters         :', JSON.stringify(after));

  await evalInExtContext(cdp, extId, `chrome.storage.sync.clear()`);
  cdp.close();

  const ok = after.hidden > 0;
  console.log('\n' + (ok ? 'REDDIT TEST PASSED' : 'REDDIT TEST FAILED (nothing culled)'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });

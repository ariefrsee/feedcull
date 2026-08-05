/* FeedCull landing waitlist test — drives the real landing page in CfT.
 * Usage: CfT on port 9224 with a landing tab open -> node test/waitlist-test.js
 * Verifies: endpoint path (fetch POST to mock/real backend), honeypot
 * (bots get pretend-success, no network call), no-endpoint fallback.
 */
'use strict';
const http = require('http');
const fs = require('fs');

const PORT = 9224;

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (x) => {
      let d = '';
      x.on('data', (c) => (d += c));
      x.on('end', () => res(JSON.parse(d || '{}')));
    }).on('error', rej);
  });
}

function attach(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => res({
      send(method, params = {}, sessionId) {
        return new Promise((r, j) => {
          const i = ++id;
          const msg = { id: i, method, params };
          if (sessionId) msg.sessionId = sessionId;
          pending.set(i, r);
          ws.send(JSON.stringify(msg));
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

async function evaluate(cdp, sess, expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sess);
  if (r.error) throw new Error(JSON.stringify(r.error));
  if (r.result && r.result.exceptionDetails) throw new Error('eval failed');
  return r.result.result.value;
}

(async () => {
  const out = [];
  const log = (...a) => { out.push(a.join(' ')); };

  const ver = await getJSON(`http://127.0.0.1:${PORT}/json/version`);
  const cdp = await attach(ver.webSocketDebuggerUrl);
  const targets = await cdp.send('Target.getTargets');
  let page = targets.result.targetInfos.find((t) => t.type === 'page' && t.url.includes('landing'));
  if (!page) {
    const created = await cdp.send('Target.createTarget', { url: 'http://127.0.0.1:8899/landing/index.html' });
    await new Promise((r) => setTimeout(r, 2500));
    const targets2 = await cdp.send('Target.getTargets');
    page = targets2.result.targetInfos.find((t) => t.targetId === created.result.targetId);
  }
  if (!page) { log('no landing tab'); fs.writeFileSync('/tmp/wl-test-out.txt', out.join('\n')); process.exit(2); }
  const att = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sess = att.result.sessionId;
  await new Promise((r) => setTimeout(r, 1500));

  /* 1. endpoint path */
  await evaluate(cdp, sess, `window.WAITLIST_ENDPOINT = 'http://127.0.0.1:8890/wl'`);
  await evaluate(cdp, sess, `(() => {
    document.getElementById('email').value = 'founder@example.com';
    document.getElementById('wl').dispatchEvent(new Event('submit'));
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  const thanks1 = await evaluate(cdp, sess, 'document.getElementById("thanks").textContent');
  const captured = fs.existsSync('/tmp/wl-captured.json') ? fs.readFileSync('/tmp/wl-captured.json', 'utf8') : '(nothing)';
  log('endpoint path thanks :', thanks1.slice(0, 70));
  log('mock captured        :', captured);
  const capOk = captured.includes('founder@example.com') && captured.includes('feedcull-landing');

  /* 2. honeypot */
  fs.writeFileSync('/tmp/wl-mark.txt', fs.readFileSync('/tmp/wl-captured.json'));
  await evaluate(cdp, sess, `(() => {
    document.getElementById('email').value = 'bot@spam.com';
    document.getElementById('company').value = 'spamco';
    document.getElementById('wl').dispatchEvent(new Event('submit'));
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  const thanks2 = await evaluate(cdp, sess, 'document.getElementById("thanks").textContent');
  const unchanged = fs.readFileSync('/tmp/wl-captured.json', 'utf8') === fs.readFileSync('/tmp/wl-mark.txt', 'utf8');
  log('honeypot thanks      :', thanks2.slice(0, 40));
  log('honeypot no network  :', unchanged);

  /* 3. no-endpoint fallback */
  await evaluate(cdp, sess, `window.WAITLIST_ENDPOINT = ''`);
  await evaluate(cdp, sess, `(() => {
    document.getElementById('email').value = 'local@example.com';
    document.getElementById('wl').dispatchEvent(new Event('submit'));
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  const thanks3 = await evaluate(cdp, sess, 'document.getElementById("thanks").textContent');
  log('fallback thanks      :', thanks3.slice(0, 60));

  const ok = capOk && unchanged && thanks3.includes('on the list');
  log(ok ? 'WAITLIST TEST PASSED' : 'WAITLIST TEST FAILED');
  fs.writeFileSync('/tmp/wl-test-out.txt', out.join('\n'));
  cdp.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { fs.writeFileSync('/tmp/wl-test-out.txt', 'ERR: ' + e.message); process.exit(2); });

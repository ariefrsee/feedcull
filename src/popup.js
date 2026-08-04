/* FeedCull popup v2 — killfile management lives here, no other tab needed.
 * Storage-backed: reads/writes chrome.storage.sync, same keys the content
 * scripts read, so changes apply on the next page load (or the reload
 * button applies them now).
 */
(function () {
  'use strict';

  var DEFAULTS = {
    enabledSites: {}, sensitivity: 'med', killDomains: [], killAuthors: [],
    culledToday: 0, lastReset: ''
  };

  function today() { return new Date().toISOString().slice(0, 10); }

  function getSettings(cb) {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      if (s.lastReset !== today()) {
        s.culledToday = 0;
        s.lastReset = today();
        chrome.storage.sync.set({ culledToday: 0, lastReset: today() });
      }
      cb(s);
    });
  }

  function normDomain(d) {
    return d.trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }

  function renderKillList(s) {
    var ul = document.getElementById('killList');
    ul.innerHTML = '';
    var items = [];
    (s.killDomains || []).forEach(function (d) { items.push({ kind: 'domain', value: d }); });
    (s.killAuthors || []).forEach(function (a) { items.push({ kind: 'author', value: a }); });
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing banned yet. Add a domain or author above.';
      ul.appendChild(empty);
      return;
    }
    items.forEach(function (it) {
      var li = document.createElement('li');
      var kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = it.kind === 'domain' ? 'site' : 'user';
      var val = document.createElement('span');
      val.className = 'val';
      val.textContent = it.value;
      var x = document.createElement('button');
      x.className = 'rm';
      x.textContent = 'x';
      x.title = 'Remove ' + it.value;
      x.addEventListener('click', function () {
        getSettings(function (cur) {
          if (it.kind === 'domain') {
            cur.killDomains = cur.killDomains.filter(function (d) { return d !== it.value; });
          } else {
            cur.killAuthors = cur.killAuthors.filter(function (a) { return a !== it.value; });
          }
          chrome.storage.sync.set({
            killDomains: cur.killDomains,
            killAuthors: cur.killAuthors
          }, function () { renderKillList(cur); });
        });
      });
      li.appendChild(kind);
      li.appendChild(val);
      li.appendChild(x);
      ul.appendChild(li);
    });
  }

  function addKill(which, inputId, normalize) {
    var input = document.getElementById(inputId);
    var raw = input.value;
    var val = normalize ? normalize(raw) : raw.trim();
    if (!val) { input.focus(); return; }
    getSettings(function (s) {
      var key = which === 'domain' ? 'killDomains' : 'killAuthors';
      var list = s[key] || [];
      if (list.indexOf(val) === -1) list.push(val);
      var set = {};
      set[key] = list;
      chrome.storage.sync.set(set, function () {
        input.value = '';
        renderKillList(s);
      });
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    var key = '';
    try { key = tab && tab.url ? new URL(tab.url).hostname : ''; } catch (e) { key = ''; }

    var toggle = document.getElementById('siteToggle');
    var sens = document.getElementById('sensitivity');

    getSettings(function (s) {
      var sites = s.enabledSites || {};
      if (key) {
        if (sites[key] === undefined) sites[key] = true;
        toggle.checked = sites[key];
      } else {
        toggle.checked = true;
        toggle.disabled = true;
      }
      sens.value = s.sensitivity || 'med';
      document.getElementById('stat').innerHTML =
        'Culled today: <b>' + (s.culledToday || 0) + '</b>';
      renderKillList(s);

      toggle.addEventListener('change', function () {
        if (!key) return;
        sites[key] = toggle.checked;
        chrome.storage.sync.set({ enabledSites: sites });
      });
      sens.addEventListener('change', function () {
        chrome.storage.sync.set({ sensitivity: sens.value });
      });

      document.getElementById('cullDomain').addEventListener('click', function () {
        if (!key) return;
        var domains = s.killDomains || [];
        if (domains.indexOf(key) === -1) domains.push(key);
        sites[key] = false;
        chrome.storage.sync.set({ killDomains: domains, enabledSites: sites }, function () {
          toggle.checked = false;
          document.getElementById('stat').innerHTML =
            '<b>Domain culled.</b> Reload the tab to apply.';
          renderKillList(s);
        });
      });

      document.getElementById('addDomain').addEventListener('click', function () {
        addKill('domain', 'newDomain', normDomain);
      });
      document.getElementById('newDomain').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addKill('domain', 'newDomain', normDomain);
      });
      document.getElementById('addAuthor').addEventListener('click', function () {
        addKill('author', 'newAuthor', null);
      });
      document.getElementById('newAuthor').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addKill('author', 'newAuthor', null);
      });

      document.getElementById('reloadTab').addEventListener('click', function () {
        if (tab && tab.id !== undefined) chrome.tabs.reload(tab.id);
      });
    });
  });

  document.getElementById('openOptions').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });
})();

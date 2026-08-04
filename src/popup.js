/* FeedCull popup v2 — killfile management lives here, no other tab needed.
 * Storage split mirrors content-core: settings in sync, counters in local.
 * Every write checks chrome.runtime.lastError — silent failures used to
 * lose killfiles (sync write quota); never swallow the error again.
 */
(function () {
  'use strict';

  var DEFAULTS = {
    enabledSites: {}, sensitivity: 'med', killDomains: [], killAuthors: [],
    topicKeywords: []
  };
  var LOCAL_DEFAULTS = { culledToday: 0, lastReset: '' };

  function today() { return new Date().toISOString().slice(0, 10); }

  function getSettings() {
    return Promise.all([
      chrome.storage.sync.get(DEFAULTS),
      chrome.storage.local.get(LOCAL_DEFAULTS)
    ]).then(function (parts) {
      var s = parts[0];
      var local = parts[1];
      if (local.lastReset !== today()) {
        local.culledToday = 0;
        local.lastReset = today();
        chrome.storage.local.set({ culledToday: 0, lastReset: today() });
      }
      s.culledToday = local.culledToday;
      return s;
    });
  }

  function write(obj) {
    return new Promise(function (resolve) {
      chrome.storage.sync.set(obj, function () {
        if (chrome.runtime.lastError) {
          document.getElementById('stat').innerHTML =
            '<b style="color:#e5484d">Save failed:</b> ' + chrome.runtime.lastError.message;
          resolve(false);
          return;
        }
        resolve(true);
      });
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
        getSettings().then(function (cur) {
          var set = {};
          if (it.kind === 'domain') {
            cur.killDomains = cur.killDomains.filter(function (d) { return d !== it.value; });
            set.killDomains = cur.killDomains;
          } else {
            cur.killAuthors = cur.killAuthors.filter(function (a) { return a !== it.value; });
            set.killAuthors = cur.killAuthors;
          }
          write(set).then(function (ok) { if (ok) renderKillList(cur); });
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
    getSettings().then(function (s) {
      var key = which === 'domain' ? 'killDomains' : 'killAuthors';
      var list = s[key] || [];
      if (list.indexOf(val) === -1) list.push(val);
      var set = {};
      set[key] = list;
      write(set).then(function (ok) {
        if (!ok) return;
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

    getSettings().then(function (s) {
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
        write({ enabledSites: sites });
      });
      sens.addEventListener('change', function () {
        write({ sensitivity: sens.value });
      });

      document.getElementById('cullDomain').addEventListener('click', function () {
        if (!key) return;
        var domains = s.killDomains || [];
        if (domains.indexOf(key) === -1) domains.push(key);
        sites[key] = false;
        write({ killDomains: domains, enabledSites: sites }).then(function (ok) {
          if (!ok) return;
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

/* FeedCull popup. */
(function () {
  'use strict';
  var DEFAULTS = {
    enabledSites: {}, sensitivity: "med", killDomains: [], culledToday: 0
  };

  function siteKey(url) {
    try { return new URL(url).hostname; } catch (e) { return ""; }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs[0];
    var key = siteKey(tab ? tab.url : "");
    if (!key) return;
    var toggle = document.getElementById("siteToggle");
    var sens = document.getElementById("sensitivity");
    chrome.storage.sync.get(DEFAULTS, function (s) {
      var sites = s.enabledSites || {};
      if (sites[key] === undefined) sites[key] = true; /* default on */
      toggle.checked = sites[key];
      sens.value = s.sensitivity || "med";
      document.getElementById("stat").innerHTML =
        "Culled today: <b>" + (s.culledToday || 0) + "</b>";
      toggle.addEventListener("change", function () {
        sites[key] = toggle.checked;
        chrome.storage.sync.set({ enabledSites: sites });
      });
      sens.addEventListener("change", function () {
        chrome.storage.sync.set({ sensitivity: sens.value });
      });
      document.getElementById("cullDomain").addEventListener("click", function () {
        var host = siteKey(tab.url);
        if (!host) return;
        var domains = s.killDomains || [];
        if (domains.indexOf(host) === -1) domains.push(host);
        chrome.storage.sync.set({ killDomains: domains }, function () {
          toggle.checked = false;
          sites[key] = false;
          chrome.storage.sync.set({ enabledSites: sites });
          document.getElementById("stat").innerHTML =
            "<b>Domain culled.</b> Reload the tab to apply.";
        });
      });
    });
  });

  document.getElementById("openOptions").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });
})();

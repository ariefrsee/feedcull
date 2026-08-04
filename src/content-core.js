/* FeedCull core: settings + decision pipeline shared by all site adapters.
 * Storage split (important):
 *   - chrome.storage.SYNC: settings that should follow the user across
 *     devices (enabledSites, sensitivity, killDomains, killAuthors,
 *     topicKeywords). Sync quota is tight (120 writes/min), so...
 *   - chrome.storage.LOCAL: high-frequency counters (culledToday). Local
 *     quota is ~1.8M writes/min — safe for per-post counting.
 * Decision order: site disabled? -> killfile/topic match (always cull)
 * -> heuristic score vs sensitivity. User holds the lever at every step.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    enabledSites: {
      "news.ycombinator.com": true,
      "reddit.com": true,
      "old.reddit.com": true
    },
    sensitivity: "med",
    killDomains: [],
    killAuthors: [],
    topicKeywords: []
  };

  var LOCAL_DEFAULTS = { culledToday: 0, lastReset: "" };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

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

  function inKillfile(s, post) {
    var domain = (post.domain || "").toLowerCase().replace(/^www\./, "");
    var author = (post.author || "").toLowerCase();
    var title = (post.title || "").toLowerCase();
    for (var i = 0; i < s.killDomains.length; i++) {
      var d = s.killDomains[i].toLowerCase().replace(/^www\./, "");
      if (d && (domain === d || domain.endsWith("." + d))) return "domain: " + s.killDomains[i];
    }
    for (var j = 0; j < s.killAuthors.length; j++) {
      var a = s.killAuthors[j].toLowerCase();
      if (a && author === a) return "author: " + s.killAuthors[j];
    }
    for (var k = 0; k < s.topicKeywords.length; k++) {
      var kw = s.topicKeywords[k].toLowerCase().trim();
      if (!kw) continue;
      /* Word-boundary match (+ optional trailing "s") so short keywords
       * like "ai" don't false-positive inside words ("Rains", "again"). */
      var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var re = new RegExp("\\b" + esc + "s?\\b", "i");
      if (re.test(title)) return "topic: " + s.topicKeywords[k];
    }
    return "";
  }

  function evaluatePost(post) {
    return getSettings().then(function (s) {
      /* Default-enabled: only an explicit false turns a site off. */
      if (s.enabledSites[post.siteKey] === false) {
        return { verdict: "keep", score: 0, reason: "site disabled" };
      }
      var kill = inKillfile(s, post);
      if (kill) {
        return { verdict: "cull", score: 100, reason: kill };
      }
      var r = global.FeedCull.decide(
        global.FeedCull.score(post.title, post.body || ""),
        s.sensitivity
      );
      r.reason = r.verdict !== "keep" ? "heuristic score " + r.score : "";
      return r;
    });
  }

  function bumpCount() {
    chrome.storage.local.get(LOCAL_DEFAULTS, function (s) {
      chrome.storage.local.set({
        culledToday: (s.culledToday || 0) + 1,
        lastReset: s.lastReset || today()
      });
    });
  }

  global.FeedCullCore = {
    DEFAULTS: DEFAULTS,
    getSettings: getSettings,
    evaluatePost: evaluatePost,
    bumpCount: bumpCount
  };
})(globalThis);

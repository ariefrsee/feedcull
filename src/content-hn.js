/* FeedCull — Hacker News adapter.
 * HN has no article body in the DOM, so v1 relies on title heuristics +
 * killfiles + topic filters. Article-text judging is phase 2 (LLM-judge).
 */
(function () {
  'use strict';
  if (!location.hostname.endsWith("news.ycombinator.com")) return;

  function rowInfo(row) {
    var a = row.querySelector(".titleline a");
    var domEl = row.querySelector(".sitestr");
    var sub = row.nextElementSibling;
    var authorEl = sub ? sub.querySelector(".hnuser") : null;
    return {
      siteKey: "news.ycombinator.com",
      title: a ? a.textContent : "",
      url: a ? a.href : "",
      domain: domEl ? domEl.textContent : "",
      author: authorEl ? authorEl.textContent : "",
      body: ""
    };
  }

  function scan() {
    var rows = document.querySelectorAll("tr.athing");
    rows.forEach(function (row) {
      if (row.dataset.feedcull === "done") return;
      row.dataset.feedcull = "done";
      FeedCullCore.evaluatePost(rowInfo(row)).then(function (r) {
        if (r.verdict !== "keep") {
          row.style.display = "none";
          var sub = row.nextElementSibling;
          if (sub && sub.classList.contains("subtext")) sub.style.display = "none";
          FeedCullCore.bumpCount();
        }
      });
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();

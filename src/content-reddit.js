/* FeedCull — Reddit adapter (new + old reddit).
 * v1: title/domain/author signals. Self-post body previews: phase 2.
 */
(function () {
  'use strict';
  var host = location.hostname;
  if (!host.endsWith("reddit.com")) return;
  var isOld = host.indexOf("old.") === 0;

  function postInfo(el) {
    var title = "", author = "", domain = "", url = "";
    if (el.tagName === "SHREDDIT-POST") {
      title = el.getAttribute("post-title") || "";
      author = el.getAttribute("author") || "";
      domain = el.getAttribute("domain") || "";
    } else if (isOld) {
      var t = el.querySelector("a.title");
      title = t ? t.textContent : "";
      var au = el.querySelector("a.author");
      author = au ? au.textContent : "";
      var d = el.querySelector(".domain");
      domain = d ? d.textContent.replace(/^\(|\)$/g, "") : "";
    } else {
      var t2 = el.querySelector("h3");
      title = t2 ? t2.textContent : "";
    }
    return {
      siteKey: host,
      title: title,
      author: author,
      domain: domain,
      url: url,
      body: ""
    };
  }

  function scan() {
    var els = document.querySelectorAll(
      'shreddit-post, .thing, [data-testid="post-container"]'
    );
    els.forEach(function (el) {
      if (el.dataset.feedcull === "done") return;
      el.dataset.feedcull = "done";
      FeedCullCore.evaluatePost(postInfo(el)).then(function (r) {
        if (r.verdict !== "keep") {
          el.style.display = "none";
          FeedCullCore.bumpCount();
        }
      });
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();

/* FeedCull options page. */
(function () {
  'use strict';
  var DEFAULTS = { sensitivity: "med", killDomains: [], killAuthors: [], topicKeywords: [] };

  function toLines(text) {
    return text.split("\n").map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  chrome.storage.sync.get(DEFAULTS, function (s) {
    document.getElementById("sensitivity").value = s.sensitivity || "med";
    document.getElementById("killDomains").value = (s.killDomains || []).join("\n");
    document.getElementById("killAuthors").value = (s.killAuthors || []).join("\n");
    document.getElementById("topicKeywords").value = (s.topicKeywords || []).join("\n");
  });

  document.getElementById("save").addEventListener("click", function () {
    chrome.storage.sync.set({
      sensitivity: document.getElementById("sensitivity").value,
      killDomains: toLines(document.getElementById("killDomains").value),
      killAuthors: toLines(document.getElementById("killAuthors").value),
      topicKeywords: toLines(document.getElementById("topicKeywords").value)
    }, function () {
      var st = document.getElementById("status");
      st.textContent = "Saved.";
      setTimeout(function () { st.textContent = ""; }, 2000);
    });
  });
})();

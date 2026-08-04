/* FeedCull heuristic engine — pure module, no browser APIs (unit-testable).
 *
 * Scores text 0-100 for "low-effort AI-slop signals". Deliberately
 * conservative by design: single signals never cull, and the user always
 * holds the lever (killfiles / topic filters override everything).
 * This is NOT an AI detector — no verdicts, no accusations. It is a
 * transparency layer that points at patterns and lets the user decide.
 */
(function (global) {
  'use strict';

  /* Strong phrases: rare in competent human writing, common in slop. */
  var STRONG_PHRASES = [
    "in today's fast-paced world", "in today's digital age",
    "in today's ever-evolving world", "in the ever-evolving",
    "as an ai language model", "as an ai,", "i'm just an ai",
    "i am just an ai", "delve", "delving", "tapestry",
    "unlock the power", "harness the power", "game-changer",
    "game changer", "revolutionize", "revolutionizing",
    "treasure trove", "in conclusion", "to summarize",
    "in summary", "it's important to note", "it is important to note",
    "it's worth noting", "it is worth noting",
    "it's crucial to understand", "comprehensive guide",
    "definitive guide", "ultimate guide"
  ];

  /* Weak phrases: common in slop, also used by humans — weighted low. */
  var WEAK_PHRASES = [
    "moreover,", "furthermore,", "seamless", "robust", "holistic",
    "synergy", "testament to", "pivotal role", "landscape of",
    "foster", "empower", "streamline", "cutting-edge", "cutting edge",
    "elevate", "unleash", "navigate the complex", "when it comes to",
    "at its core", "in the realm of", "let's dive in", "lets dive in",
    "unparalleled", "the intersection of"
  ];

  /* Patterns not covered by phrases (avoid double counting). */
  var STRONG_PATTERNS = [
    /\bI(?:'m| am) (?:just |only )?an ai\b/i,
    /\b(?:generated|written) (?:by|with) ai\b/i,
    /\ball in all[,.]/i
  ];

  var HEDGES = [
    "arguably", "undoubtedly", "clearly", "obviously", "in many ways",
    "essentially", "notably", "interestingly", "importantly",
    "simply put", "needless to say"
  ];

  function countHits(text, list) {
    var lower = " " + text.toLowerCase() + " ";
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var idx = lower.indexOf(list[i]);
      while (idx !== -1) {
        n++;
        idx = lower.indexOf(list[i], idx + 1);
      }
    }
    return n;
  }

  function countPatterns(text, list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var m = text.match(list[i]);
      if (m) n += m.length;
    }
    return n;
  }

  function wordCount(text) {
    return (text.match(/\S+/g) || []).length;
  }

  function emDashPer50(text) {
    var words = wordCount(text);
    if (words < 10) return 0;
    return (text.match(/—/g) || []).length / (words / 50);
  }

  function hedgeRatio(text) {
    var words = wordCount(text);
    if (words < 10) return 0;
    var n = 0;
    var lower = text.toLowerCase();
    for (var i = 0; i < HEDGES.length; i++) {
      var idx = lower.indexOf(HEDGES[i]);
      while (idx !== -1) {
        n++;
        idx = lower.indexOf(HEDGES[i], idx + 1);
      }
    }
    return n / words;
  }

  function genericOpeners(text) {
    var sentences = text.split(/[.!?]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (sentences.length < 3) return 0;
    var generic = 0;
    for (var i = 0; i < sentences.length; i++) {
      if (/^(in|the|it|this|one|as|a)\s/i.test(sentences[i])) generic++;
    }
    return generic / sentences.length;
  }

  function score(title, body) {
    var hasBody = body && body.trim().length > 0;
    var text = hasBody ? title + " " + body : title;
    if (!text.trim()) return 0;

    var strongP = countHits(text, STRONG_PHRASES);
    var weakP = countHits(text, WEAK_PHRASES);
    var strongR = countPatterns(text, STRONG_PATTERNS);

    var phrasePts = Math.min(45, strongP * 3 + weakP);
    var patternPts = Math.min(30, strongR * 5);

    var s = phrasePts + patternPts;

    if (hasBody && wordCount(body) >= 10) {
      var e = emDashPer50(body);
      var h = hedgeRatio(body);
      var g = genericOpeners(body);
      s += Math.min(10, e * 5);
      s += Math.min(10, h * 200);
      s += Math.min(10, g * 150);
    } else {
      /* Titles are dense with intent; boost slightly, stay conservative. */
      s = Math.round(s * 1.6);
    }

    return Math.min(100, Math.round(s));
  }

  var THRESHOLDS = {
    low:  { flag: 40, cull: 65 },
    med:  { flag: 30, cull: 50 },
    high: { flag: 20, cull: 40 }
  };

  function decide(scoreVal, sensitivity) {
    var t = THRESHOLDS[sensitivity] || THRESHOLDS.med;
    if (scoreVal >= t.cull) return { verdict: "cull", score: scoreVal };
    if (scoreVal >= t.flag) return { verdict: "flag", score: scoreVal };
    return { verdict: "keep", score: scoreVal };
  }

  global.FeedCull = {
    score: score,
    decide: decide,
    THRESHOLDS: THRESHOLDS
  };
})(typeof window !== "undefined" ? window : globalThis);

/* FeedCull heuristic engine unit tests. Run: node test/heuristics.test.js */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'heuristics.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const F = sandbox.FeedCull;

const AI_SLOP =
  "In today's fast-paced world, it's important to note that AI-powered " +
  "solutions are revolutionizing the way we work. As an AI language model, " +
  "I can't help but delve into the tapestry of possibilities — a treasure " +
  "trove of insight, at its core. Moreover, this game-changer empowers " +
  "teams to streamline their workflows. In conclusion, teams can harness " +
  "the power of cutting-edge tools — a testament to the pivotal role of " +
  "innovation in the realm of business. In summary, it's crucial to " +
  "understand that this comprehensive guide will unlock the power of AI " +
  "for everyone.";

const HUMAN =
  "Shipped a fix for the pagination bug last night. The feed was dropping " +
  "every third item after page 2 because the observer wasn't attached to " +
  "the new container. I patched it, added a regression test, and deployed. " +
  "One thing I'm not sure about: the caching layer might still serve stale " +
  "stories, so I'm keeping an eye on it this week.";

const SLOP_TITLE =
  "In today's digital age, this comprehensive guide will unlock the power " +
  "of AI — game-changer insights, at its core";

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name); }
}

const s1 = F.score("", AI_SLOP);
const s2 = F.score("", HUMAN);
const s3 = F.score(SLOP_TITLE, "");

console.log("AI-slop body score: " + s1 + "  (expect > 50)");
console.log("human body score : " + s2 + "  (expect < 25)");
console.log("slop title score : " + s3 + "  (expect 20-39)");
console.log("");

check("slop body scores high", s1 > 50);
check("human body scores low", s2 < 25);
check("decide(slop, med) culls", F.decide(s1, "med").verdict === "cull");
check("decide(slop, low) flags (not cull)", F.decide(s1, "low").verdict === "flag");
check("decide(human, med) keeps", F.decide(s2, "med").verdict === "keep");
check("decide(human, high) keeps", F.decide(s2, "high").verdict === "keep");
check("slop title flagged at high sensitivity", F.decide(s3, "high").verdict === "flag");
check("slop title kept at med (conservative by design)", F.decide(s3, "med").verdict === "keep");
check("empty text scores 0", F.score("", "") === 0);
check("scores are capped at 100", F.score("", AI_SLOP + AI_SLOP + AI_SLOP) <= 100);

console.log(fail === 0 ? "\nALL TESTS PASSED (" + pass + ")" : "\n" + fail + " TEST(S) FAILED");
process.exit(fail === 0 ? 0 : 1);

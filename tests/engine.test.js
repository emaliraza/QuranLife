/* Unit tests for the Sukoon recitation engine. Run: node tests/engine.test.js */
const assert = require("assert");
const R = require("../www/recite-engine.js");

let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.log("FAIL", name, "\n   ", e.message); } }
function types(res) { return res.tokens.map(x => x.type).join(","); }

const V = {
  ibrahim: "لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ",
  sharh: "فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ۝ إِنَّ مَعَ الْعُسْرِ يُسْرًا",
  zumar: "قُلْ يَا عِبَادِيَ الَّذِينَ أَسْرَفُوا عَلَىٰ أَنفُسِهِمْ لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ ۚ إِنَّ اللَّهَ يَغْفِرُ الذُّنُوبَ جَمِيعًا",
  raad: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ",
  nahl: "وَإِن تَعُدُّوا نِعْمَةَ اللَّهِ لَا تُحْصُوهَا ۗ إِنَّ اللَّهَ لَغَفُورٌ رَّحِيمٌ",
  baqarah: "فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ",
  duha: "مَا وَدَّعَكَ رَبُّكَ وَمَا قَلَىٰ",
  tin: "لَقَدْ خَلَقْنَا الْإِنسَانَ فِي أَحْسَنِ تَقْوِيمٍ"
};

/* ---- normalization ---- */
t("strips harakat", () => assert.strictEqual(R.normalizeWord("شَكَرْتُمْ"), "شكرتم"));
t("alef variants unify", () => { assert.strictEqual(R.normalizeWord("أَنفُسِهِمْ"), R.normalizeWord("انفسهم")); assert.strictEqual(R.normalizeWord("إِنَّ"), "ان"); assert.strictEqual(R.normalizeWord("آلَاءِ"), R.normalizeWord("الاء")); assert.strictEqual(R.normalizeWord("ٱللَّهِ"), "الله"); });
t("taa marbuta and maqsura unify", () => { assert.strictEqual(R.normalizeWord("رَحْمَةِ"), R.normalizeWord("رحمه")); assert.strictEqual(R.normalizeWord("عَلَىٰ"), R.normalizeWord("علي")); });
t("hamza on carriers unify", () => { assert.strictEqual(R.normalizeWord("لَئِن"), R.normalizeWord("لين")); assert.strictEqual(R.normalizeWord("مُّؤْمِنِينَ"), R.normalizeWord("مومنين")); });
t("annotation signs and tatweel dropped", () => { assert.strictEqual(R.normalizeWord("۝"), ""); assert.strictEqual(R.normalizeWord("ۗ"), ""); assert.strictEqual(R.normalizeWord("شـكـر"), "شكر"); });
t("latin and digits dropped", () => assert.strictEqual(R.normalizeWord("abc123شكر"), "شكر"));
t("tokenize skips symbol-only tokens", () => assert.strictEqual(R.tokenize(V.sharh).length, 8));

/* ---- alignment ---- */
t("exact match scores 100", () => { const r = R.evaluate(V.ibrahim, "لئن شكرتم لأزيدنكم"); assert.strictEqual(r.score, 100); assert.strictEqual(types(r), "ok,ok,ok"); });
t("fully vowelled input matches too", () => assert.strictEqual(R.evaluate(V.ibrahim, V.ibrahim).score, 100));
t("missing word detected", () => { const r = R.evaluate(V.ibrahim, "لئن لأزيدنكم"); assert.strictEqual(types(r), "ok,missing,ok"); assert.strictEqual(r.score, 67); });
t("extra word detected", () => { const r = R.evaluate(V.ibrahim, "لئن شكرتم كثيرا لأزيدنكم"); assert.strictEqual(types(r), "ok,ok,extra,ok"); assert.strictEqual(r.score, 100); assert.strictEqual(r.flagged, 1); });
t("wrong word detected with similarity", () => { const r = R.evaluate(V.ibrahim, "لئن شكرتم لأزيدكم"); assert.strictEqual(types(r), "ok,ok,wrong"); assert.ok(r.tokens[2].similarity > 0.7); });
t("empty input: everything missing", () => { const r = R.evaluate(V.ibrahim, ""); assert.strictEqual(types(r), "missing,missing,missing"); assert.strictEqual(r.score, 0); });
t("garbage input: no crash, low score", () => { const r = R.evaluate(V.ibrahim, "hello world 123"); assert.strictEqual(r.score, 0); assert.strictEqual(r.heardCount, 0); });
t("repeated verse (sharh) aligns across the separator", () => { const r = R.evaluate(V.sharh, "فإن مع العسر يسرا إن مع العسر يسرا"); assert.strictEqual(r.score, 100); });
t("skipping the second half is 4 missing", () => { const r = R.evaluate(V.sharh, "فإن مع العسر يسرا"); assert.strictEqual(r.tokens.filter(x => x.type === "missing").length, 4); });
t("long verse with one slip", () => { const r = R.evaluate(V.zumar, "قل يا عبادي الذين أسرفوا على أنفسهم لا تقنطوا من رحمة الله إن الله يغفر الذنوب جميعا"); assert.strictEqual(r.score, 100); const r2 = R.evaluate(V.zumar, "قل يا عبادي الذين أسرفوا على أنفسهم لا تقنطوا من رحمة الله إن الله يغفر الذنب جميعا"); assert.strictEqual(r2.flagged, 1); assert.strictEqual(r2.tokens.find(x => x.type === "wrong").expected.norm, "الذنوب"); });
t("word order swap is flagged not silently accepted", () => { const r = R.evaluate(V.raad, "ألا بذكر تطمئن الله القلوب"); assert.ok(r.flagged >= 1); assert.ok(r.score < 100); });
t("tokens carry guide, makhraj and tajweed on flagged words", () => { const r = R.evaluate(V.raad, "الا بذكر الله تطمئن"); const m = r.tokens.find(x => x.type === "missing"); assert.strictEqual(m.expected.norm, "القلوب"); assert.strictEqual(m.guide, "al-quloobu"); assert.ok(m.makhraj.some(x => x.letter === "ق")); assert.ok(m.tajweed.some(x => x.rule === "Heavy letters")); });
t("ok tokens have guide but no corrections", () => { const r = R.evaluate(V.raad, "ألا بذكر الله تطمئن القلوب"); assert.ok(r.tokens.every(x => x.guide && !x.makhraj)); });
t("messages by score", () => { assert.ok(/MashaAllah/.test(R.evaluate(V.duha, "ما ودعك ربك وما قلى").message)); assert.ok(/slow/.test(R.evaluate(V.zumar, "قل").message)); });

/* ---- transliteration ---- */
const TR = [["لَئِن", "la’in"], ["شَكَرْتُمْ", "shakartum"], ["لَأَزِيدَنَّكُمْ", "la’azeedannakum"], ["اللَّهِ", "Allaahi"], ["اللَّهَ", "Allaaha"], ["الرَّحْمَٰنِ", "ar-raḥmaani"], ["الْقُلُوبُ", "al-quloobu"], ["وَاشْكُرُوا", "washkuroo"], ["فَاذْكُرُونِي", "fadhkuroonee"], ["آلَاءِ", "aalaa’i"], ["إِنَّ", "inna"], ["يُسْرًا", "yusran"], ["عَمَلًا", "‘amalan"], ["قَلَىٰ", "qalaa"], ["نِعْمَةَ", "ni‘mata"], ["رَحْمَةِ", "raḥmati"], ["تَقْوِيمٍ", "taqweemin"], ["مُّؤْمِنِينَ", "mu’mineena"], ["الْإِنسَانَ", "al-insaana"], ["حَبْلِ", "ḥabli"]];
TR.forEach(([ar, want]) => t("transliterate " + ar, () => assert.strictEqual(R.transliterate(ar), want)));
t("transliterate never throws on odd input", () => { ["", "۝", "ۗ", "abc", "َّ", "اللَّه", "ا", "ال"].forEach(w => R.transliterate(w)); });

/* ---- tajweed hints ---- */
function rules(w, prev) { return R.tajweedHints(w, prev).map(h => h.rule); }
t("ghunnah on shadda noon", () => assert.ok(rules("لَأَزِيدَنَّكُمْ").includes("Ghunnah")));
t("ikhfa noon before seen", () => assert.ok(rules("الْإِنسَانَ").includes("Ikhfa")));
t("qalqalah on sukun qaf", () => assert.ok(rules("لَقَدْ").includes("Qalqalah")));
t("qalqalah on final dal when stopping", () => assert.ok(rules("لَقَدْ").includes("Qalqalah")));
t("heavy lam after fatha", () => assert.ok(rules("اللَّهِ", "رَحْمَتَ").includes("Heavy Lam")));
t("light lam after kasra", () => assert.ok(rules("اللَّهِ", "بِذِكْرِ").includes("Light Lam")));
t("heavy letters listed", () => assert.ok(rules("تَقْنَطُوا").includes("Heavy letters")));
t("madd before hamza", () => assert.ok(rules("آلَاءِ").includes("Madd")));
t("natural madd fallback", () => assert.ok(rules("يَا").includes("Natural madd")));
t("iqlab noon before ba", () => assert.ok(rules("أَنبِئْهُم").includes("Iqlab")));
t("idgham noon before ya", () => assert.ok(rules("مَنْيَعْمَلْ").includes("Idgham")));

/* ---- makhraj notes ---- */
t("makhraj lists only differing letters", () => { const n = R.makhrajNotes("قلوب", "كلوب"); assert.deepStrictEqual(n.map(x => x.letter), ["ق"]); assert.ok(/soft palate/.test(n[0].note)); });
t("makhraj for a skipped word lists all its letters with notes", () => { const n = R.makhrajNotes("عسر", ""); assert.deepStrictEqual(n.map(x => x.letter), ["ع", "س", "ر"]); });
t("every arabic letter has a makhraj note", () => { "ءابتثجحخدذرزسشصضطظعغفقكلمنهوي".split("").forEach(c => assert.ok(R.MAKHRAJ[c], "missing " + c)); });

/* ---- render ---- */
t("renderTranscript wraps wrong/missing/extra in red-highlight", () => { const r = R.evaluate(V.ibrahim, "لئن شكرتم كثيرا لأزيدكم"); const html = R.renderTranscript(r.tokens, s => s); assert.ok(html.includes('class="red-highlight extra"')); assert.ok(html.includes('class="red-highlight"')); assert.ok(html.includes('class="ok-word"')); const r2 = R.evaluate(V.ibrahim, "لئن"); assert.ok(R.renderTranscript(r2.tokens, s => s).includes("red-highlight missing")); });
t("renderTranscript escapes through the caller", () => { const r = R.evaluate(V.ibrahim, "<b>لئن</b>"); const html = R.renderTranscript(r.tokens, s => s.replace(/</g, "&lt;")); assert.ok(!/<b>/.test(html)); });

/* ---- meaning check ---- */
t("meaning: paraphrase with synonym passes", () => assert.ok(R.evaluateMeaning("If you are grateful, I will surely give you more.", "if you are thankful he will give you more").score >= 80));
t("meaning: unrelated text fails", () => assert.ok(R.evaluateMeaning("Truly, in the remembrance of Allah do hearts find rest.", "the weather is nice today").score < 50));
t("meaning: empty input is 0", () => assert.strictEqual(R.evaluateMeaning("Call on Me, I will answer you.", "").score, 0));

/* ---- fuzz ---- */
t("fuzz: 400 random inputs never throw", () => {
  const alphabet = "ءابتثجحخدذرزسشصضطظعغفقكلمنهويةىأإآئؤ ًٌٍَُِّْٰ ۝ۗabc 123";
  const verses = Object.values(V);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) {
    let s = ""; const len = Math.floor(rnd() * 60);
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    const v = verses[i % verses.length];
    const r = R.evaluate(v, s); assert.ok(r.score >= 0 && r.score <= 100); R.renderTranscript(r.tokens, x => x);
    r.tokens.forEach(tk => { if (tk.type !== "ok" && tk.expected) { assert.ok(typeof tk.guide === "string"); assert.ok(Array.isArray(tk.tajweed)); } });
    R.evaluateMeaning("Some meaning text here for coverage", s);
  }
});
t("every app verse transliterates without an empty word", () => {
  const src = require("fs").readFileSync(__dirname + "/../www/index.html", "utf8");
  const ars = [...src.matchAll(/ar:"([^"]+)"/g)].map(m => m[1]).filter(a => /[ء-ي]/.test(a));
  assert.ok(ars.length >= 23, "found " + ars.length + " verses");
  ars.forEach(a => R.tokenize(a).forEach(w => { const g = R.transliterate(w.raw); assert.ok(g.length > 0, "empty guide for " + w.raw); assert.ok(!/undefined/.test(g)); }));
});

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

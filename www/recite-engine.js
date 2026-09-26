/* Quran Live recitation engine for Sukoon.
   Pure functions, no DOM. Works in the browser and in node (for tests).

   What it does honestly:
   - normalizes Arabic text so a speech recognizer's output can be compared with the verse
   - aligns heard words with expected words and marks each as ok, wrong, missing or extra
   - builds a pronunciation guide (rule-based transliteration) for any flagged word
   - points out which letters differ and describes their makhraj (articulation point)
   - lists the Tajweed rules present in the correct word so the reciter knows what to apply
   - checks a spoken English meaning against the verse meaning by key-word coverage

   What it cannot do: hear articulation points or harakat directly. Speech recognizers
   return plain letters. Word accuracy is measured; makhraj and rules are taught from the text. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReciteEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {

  var DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

  function normalizeWord(w) {
    return String(w || "")
      .replace(DIAC, "")
      .replace(/[آأإٱ]/g, "ا") /* آ أ إ ٱ -> ا */
      .replace(/ة/g, "ه")                     /* ة -> ه */
      .replace(/ى/g, "ي")                     /* ى -> ي */
      .replace(/ؤ/g, "و")                     /* ؤ -> و */
      .replace(/ئ/g, "ي")                     /* ئ -> ي */
      .replace(/[^ء-ي]/g, "");
  }
  function tokenize(text) {
    return String(text || "").split(/\s+/).map(function (raw) { return { raw: raw, norm: normalizeWord(raw) }; }).filter(function (t) { return t.norm.length > 0; });
  }

  function levenshtein(a, b) {
    var m = a.length, n = b.length, i, j, prev, tmp;
    if (!m) return n; if (!n) return m;
    var row = new Array(n + 1);
    for (j = 0; j <= n; j++) row[j] = j;
    for (i = 1; i <= m; i++) {
      prev = row[0]; row[0] = i;
      for (j = 1; j <= n; j++) {
        tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[n];
  }
  function similarity(a, b) { var L = Math.max(a.length, b.length); return L ? 1 - levenshtein(a, b) / L : 1; }

  /* Word alignment. Returns tokens in reading order:
     {type:"ok"|"wrong"|"missing"|"extra", expected:{raw,norm}|null, heard:{raw,norm}|null, similarity} */
  function align(expectedText, heardText) {
    var E = tokenize(expectedText), H = tokenize(heardText);
    var m = E.length, n = H.length, i, j;
    var D = [], B = [];
    for (i = 0; i <= m; i++) { D.push(new Array(n + 1)); B.push(new Array(n + 1)); D[i][0] = i; B[i][0] = "del"; }
    for (j = 0; j <= n; j++) { D[0][j] = j; B[0][j] = "ins"; }
    B[0][0] = null;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      var same = E[i - 1].norm === H[j - 1].norm;
      var sim = same ? 1 : similarity(E[i - 1].norm, H[j - 1].norm);
      var subCost = same ? 0 : (sim >= 0.5 ? 0.9 : 1.1);
      var sub = D[i - 1][j - 1] + subCost, del = D[i - 1][j] + 1, ins = D[i][j - 1] + 1;
      var best = Math.min(sub, del, ins);
      D[i][j] = best; B[i][j] = best === sub ? "sub" : best === del ? "del" : "ins";
    }
    var out = []; i = m; j = n;
    while (i > 0 || j > 0) {
      var op = B[i][j];
      if (op === "sub") { var e = E[i - 1], h = H[j - 1]; var s = e.norm === h.norm; out.push({ type: s ? "ok" : "wrong", expected: e, heard: h, similarity: s ? 1 : similarity(e.norm, h.norm) }); i--; j--; }
      else if (op === "del") { out.push({ type: "missing", expected: E[i - 1], heard: null, similarity: 0 }); i--; }
      else { out.push({ type: "extra", expected: null, heard: H[j - 1], similarity: 0 }); j--; }
    }
    out.reverse();
    var correct = out.filter(function (t) { return t.type === "ok"; }).length;
    return { tokens: out, expectedCount: m, heardCount: n, correct: correct, score: m ? Math.round(100 * correct / m) : 0 };
  }

  /* ---------- Transliteration (pronunciation guide) ---------- */
  var CONS = { "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "ḥ", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "ṣ", "ض": "ḍ", "ط": "ṭ", "ظ": "ẓ", "ع": "‘", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y", "ء": "’", "أ": "’", "إ": "’", "ئ": "’", "ؤ": "’", "آ": "’aa", "ة": "h" };
  var VOW = { "َ": "a", "ِ": "i", "ُ": "u", "ً": "an", "ٍ": "in", "ٌ": "un" };
  var SHADDA = "ّ", SUKUN = "ْ", DAGGER = "ٰ", MADD = "ٓ";
  var ALEF = "ا", WASLA = "ٱ", LAM = "ل", WAW = "و", YA = "ي", MAQSURA = "ى", TAA_M = "ة";
  var MARKS = /[ً-ٰٓ]/;

  function parseWord(raw) {
    /* split into [{ch, marks:[...]}] ignoring quran annotation signs */
    var chars = String(raw).replace(/[ۖ-ۭـؐ-ؚ]/g, "").split("");
    var units = [];
    for (var k = 0; k < chars.length; k++) {
      var c = chars[k];
      if (MARKS.test(c)) { if (units.length) units[units.length - 1].marks.push(c); }
      else units.push({ ch: c, marks: [] });
    }
    return units;
  }
  function transliterate(raw) {
    var u = parseWord(raw);
    var norm = normalizeWord(raw);
    var out = "", k, lastVowel = "";
    if (norm === "الله") { /* Allah */
      var last = u[u.length - 1], lv = "";
      for (k = 0; k < last.marks.length; k++) if (VOW[last.marks[k]]) lv = VOW[last.marks[k]];
      return "Allaah" + lv;
    }
    var start = 0;
    /* definite article with sun letter: al- / ar- etc */
    if (u.length >= 3 && (u[0].ch === ALEF || u[0].ch === WASLA) && u[1].ch === LAM && u[2].marks.indexOf(SHADDA) >= 0) {
      var c2 = CONS[u[2].ch] || "";
      out = "a" + c2 + "-"; start = 2; u[2].marks = u[2].marks.filter(function (x) { return x !== SHADDA; });
    } else if (u.length >= 2 && (u[0].ch === ALEF || u[0].ch === WASLA) && u[1].ch === LAM && !hasVowel(u[1])) {
      out = "al-"; start = 2;
    }
    for (k = start; k < u.length; k++) {
      var un = u[k], ch = un.ch, marks = un.marks;
      var vowel = "", shadda = marks.indexOf(SHADDA) >= 0, hasMadd = marks.indexOf(MADD) >= 0, dagger = marks.indexOf(DAGGER) >= 0;
      for (var q = 0; q < marks.length; q++) if (VOW[marks[q]]) vowel = VOW[marks[q]];
      var atStart = out === "" || out === "al-";
      if (ch === ALEF || ch === WASLA) {
        if (out === "") { out += vowel || "a"; lastVowel = vowel || "a"; continue; }
        if (!vowel && !shadda) {
          if (lastVowel === "an") { continue; } /* tanween alef is silent */
          if (k === u.length - 1 && lastVowel === "oo") { continue; } /* silent alef after a long waw at the end of a word */
          if (k + 1 < u.length && u[k + 1].marks.indexOf(SUKUN) >= 0 && u[k + 1].marks.indexOf(SHADDA) < 0) { continue; } /* hamzat wasl, not stretched */
          out = out.replace(/a$/, "") + "aa" + (hasMadd ? "a" : ""); lastVowel = "aa"; continue;
        }
        out += "’" + vowel; lastVowel = vowel; continue;
      }
      if (ch === MAQSURA) { out = out.replace(/a$/, "") + "aa"; lastVowel = "aa"; continue; }
      if (ch === WAW && !vowel && !shadda && lastVowel === "u") { out = out.replace(/u$/, "oo") + (hasMadd ? "o" : ""); lastVowel = "oo"; continue; }
      if (ch === YA && !vowel && !shadda && lastVowel === "i") { out = out.replace(/i$/, "ee") + (hasMadd ? "e" : ""); lastVowel = "ee"; continue; }
      if (ch === TAA_M) { out += (vowel ? "t" + vowel : "h"); lastVowel = vowel; continue; }
      var cons = CONS[ch];
      if (cons === undefined) continue;
      if (atStart && cons.charAt(0) === "’") cons = cons.slice(1);
      if (shadda && out !== "") cons = cons + (cons.length === 1 ? cons : "");
      out += cons + vowel;
      if (dagger) { out = out.replace(/a$/, "") + "aa"; vowel = "aa"; }
      lastVowel = vowel;
    }
    return out;
  }
  function hasVowel(un) { for (var i = 0; i < un.marks.length; i++) if (VOW[un.marks[i]]) return true; return false; }

  /* ---------- Makhraj (articulation) notes ---------- */
  var MAKHRAJ = {
    "ء": "Hamza: a small catch from the bottom of the throat, like the start of ‘uh-oh’.",
    "ه": "Ha: soft breath from the bottom of the throat, like a sigh.",
    "ع": "Ain: from the middle of the throat, squeeze the throat slightly. No English sound matches it.",
    "ح": "Haa: from the middle of the throat, a strong breathy h with no gargle.",
    "غ": "Ghain: from the top of the throat, like a soft gargled g (French r).",
    "خ": "Khaa: from the top of the throat, like clearing your throat softly.",
    "ق": "Qaf: back of the tongue pressed against the soft palate, a deep heavy k.",
    "ك": "Kaf: back of the tongue slightly forward from Qaf, a light k.",
    "ج": "Jeem: middle of the tongue against the roof of the mouth, j as in jam.",
    "ش": "Sheen: middle of the tongue, spread the air, sh as in ship.",
    "ي": "Ya: middle of the tongue, y as in yes.",
    "ض": "Daad: side of the tongue pressed against the upper molars, a heavy d. Unique to Arabic.",
    "ل": "Lam: tip of the tongue against the upper gums, l as in lamp.",
    "ن": "Noon: tip of the tongue against the upper gums with sound through the nose.",
    "ر": "Ra: tip of the tongue tapping the upper gums, a rolled r.",
    "ط": "Taa: tip of the tongue at the base of the upper front teeth, heavy t, fill the mouth.",
    "د": "Dal: tip of the tongue at the base of the upper front teeth, d as in door.",
    "ت": "Ta: tip of the tongue at the base of the upper front teeth, light t.",
    "ص": "Saad: tip of the tongue near the lower front teeth, heavy hissing s.",
    "س": "Seen: tip of the tongue near the lower front teeth, light s.",
    "ز": "Zay: tip of the tongue near the lower front teeth, z as in zoo.",
    "ظ": "Dhaa: tip of the tongue between the front teeth, heavy th as in ‘this’ with a full mouth.",
    "ذ": "Dhal: tip of the tongue between the front teeth, th as in ‘this’.",
    "ث": "Thaa: tip of the tongue between the front teeth, th as in ‘think’.",
    "ف": "Fa: bottom lip touching the upper front teeth, f as in fan.",
    "ب": "Ba: both lips pressed together, b as in book.",
    "م": "Meem: both lips pressed together with sound through the nose.",
    "و": "Waw: lips rounded, w as in we.",
    "ا": "Alif: open the mouth and let the sound flow, a long aa."
  };
  var HEAVY = "خصضغطقظ";
  var QALQALAH = "قطبجد";
  var IKHFA = "تثجدذزسشصضطظفقك";
  var IDGHAM_GH = "ينمو";
  var HAMZAS = "ءأإئؤآ";
  var LETTER_NAMES = { "ء": "Hamza", "ا": "Alif", "ب": "Ba", "ت": "Ta", "ث": "Thaa", "ج": "Jeem", "ح": "Haa", "خ": "Khaa", "د": "Dal", "ذ": "Dhal", "ر": "Ra", "ز": "Zay", "س": "Seen", "ش": "Sheen", "ص": "Saad", "ض": "Daad", "ط": "Taa", "ظ": "Dhaa", "ع": "Ain", "غ": "Ghain", "ف": "Fa", "ق": "Qaf", "ك": "Kaf", "ل": "Lam", "م": "Meem", "ن": "Noon", "ه": "Ha", "و": "Waw", "ي": "Ya" };
  function letterName(ch) { var n = normalizeWord(ch); return LETTER_NAMES[n] || ch; }

  /* Letters present in the expected word but not heard (or heard differently). */
  function letterDiff(expectedNorm, heardNorm) {
    var e = expectedNorm.split(""), h = (heardNorm || "").split("");
    var counts = {}, out = [], i;
    for (i = 0; i < h.length; i++) counts[h[i]] = (counts[h[i]] || 0) + 1;
    for (i = 0; i < e.length; i++) { var c = e[i]; if (counts[c]) counts[c]--; else if (out.indexOf(c) < 0) out.push(c); }
    return out;
  }
  function makhrajNotes(expectedNorm, heardNorm) {
    var diff = letterDiff(expectedNorm, heardNorm);
    return diff.filter(function (c) { return MAKHRAJ[c]; }).map(function (c) { return { letter: c, name: letterName(c), note: MAKHRAJ[c] }; });
  }

  /* Tajweed rules visible in the correct word (from its marks). prevRaw is the previous word, for the laam of Allah. */
  function tajweedHints(raw, prevRaw) {
    var u = parseWord(raw), hints = [], k, names;
    var norm = normalizeWord(raw);
    for (k = 0; k < u.length; k++) {
      var ch = u[k].ch, m = u[k].marks, isLast = k === u.length - 1, sukun = m.indexOf(SUKUN) >= 0, noVowel = !hasVowel(u[k]) && m.indexOf(SHADDA) < 0;
      if (QALQALAH.indexOf(ch) >= 0 && (sukun || (isLast && noVowel))) hints.push({ rule: "Qalqalah", text: "Bounce the " + letterName(ch) + " with a small echo, since it carries sukun" + (isLast ? " when you stop on it" : "") + "."});
      if ((ch === "ن" || ch === "م") && m.indexOf(SHADDA) >= 0) hints.push({ rule: "Ghunnah", text: "Hold the nasal sound on the doubled " + letterName(ch) + " for two counts." });
      if (ch === "ن" && (sukun || (!hasVowel(u[k]) && m.indexOf(SHADDA) < 0)) && k + 1 < u.length) {
        var nx = u[k + 1].ch;
        if (IKHFA.indexOf(nx) >= 0) hints.push({ rule: "Ikhfa", text: "Hide the Noon in the nose before " + letterName(nx) + ", do not press the tongue." });
        else if (IDGHAM_GH.indexOf(nx) >= 0) hints.push({ rule: "Idgham", text: "Merge the Noon into the " + letterName(nx) + " with a nasal sound." });
        else if (nx === "ب") hints.push({ rule: "Iqlab", text: "Turn the Noon into a soft Meem before the Ba, with a nasal sound." });
      }
      if (m.indexOf(MADD) >= 0 || ((ch === ALEF || ch === WAW || ch === YA || ch === MAQSURA) && noVowel && k + 1 < u.length && HAMZAS.indexOf(u[k + 1].ch) >= 0)) hints.push({ rule: "Madd", text: "Stretch the long vowel here for four to five counts." });
    }
    names = [];
    for (k = 0; k < norm.length; k++) if (HEAVY.indexOf(norm[k]) >= 0 && names.indexOf(letterName(norm[k])) < 0) names.push(letterName(norm[k]));
    if (names.length) hints.push({ rule: "Heavy letters", text: names.join(", ") + ": fill the mouth with the sound, keep the tongue heavy." });
    if (norm === "الله" && prevRaw) {
      var p = parseWord(prevRaw); var last = p[p.length - 1]; var lv = "";
      if (last) for (k = 0; k < last.marks.length; k++) if (VOW[last.marks[k]]) lv = VOW[last.marks[k]];
      if (last && (last.ch === YA || last.ch === MAQSURA || lv === "i" || lv === "in")) hints.push({ rule: "Light Lam", text: "The Lam of Allah is light here because the sound before it is a kasra." });
      else hints.push({ rule: "Heavy Lam", text: "The Lam of Allah is heavy here because the sound before it is a fatha or damma." });
    }
    if (!hints.length && /[اويى]/.test(norm)) hints.push({ rule: "Natural madd", text: "Long vowels stretch for two counts, no more." });
    return hints;
  }

  /* Full evaluation for the UI. */
  function evaluate(expectedText, heardText) {
    var res = align(expectedText, heardText);
    var E = tokenize(expectedText);
    var expIdx = 0;
    res.tokens.forEach(function (t) {
      if (t.expected) {
        var prev = expIdx > 0 ? E[expIdx - 1].raw : "";
        t.guide = transliterate(t.expected.raw);
        if (t.type !== "ok") {
          t.makhraj = makhrajNotes(t.expected.norm, t.heard ? t.heard.norm : "");
          t.tajweed = tajweedHints(t.expected.raw, prev);
        }
        expIdx++;
      }
    });
    var flagged = res.tokens.filter(function (t) { return t.type !== "ok"; }).length;
    res.flagged = flagged;
    res.message = res.score >= 95 && flagged === 0 ? "MashaAllah. Every word in its place." : res.score >= 80 ? "Very close. A little polish on " + flagged + (flagged === 1 ? " word." : " words.") : res.score >= 50 ? "Good effort. Let’s fix these together, one word at a time." : "Let’s slow down. Read the verse once with the guide, then try again.";
    return res;
  }

  /* HTML for the transcript with red highlighting. esc is the caller's HTML escaper. */
  function renderTranscript(tokens, esc) {
    return tokens.map(function (t) {
      if (t.type === "ok") return '<span class="ok-word">' + esc(t.heard.raw) + '</span>';
      if (t.type === "wrong") return '<span class="red-highlight" title="' + esc(t.expected.raw) + '">' + esc(t.heard.raw) + '</span>';
      if (t.type === "extra") return '<span class="red-highlight extra" title="extra word">' + esc(t.heard.raw) + '</span>';
      return '<span class="red-highlight missing" title="missing">' + esc(t.expected.raw) + '</span>';
    }).join(" ");
  }

  /* ---------- Spoken meaning check ---------- */
  var STOP = "a an the of to in on and or is are was were be been it its this that those these he she they we you i me my his her their our your for with from by as at so do does did not no yes will shall would should can could may might have has had which who whom what when where why how than then there here into onto upon over under very truly indeed surely o say them him us".split(" ");
  var SYN = { thankful: "grateful", thanks: "grateful", thank: "grateful", gratitude: "grateful", humans: "human", mankind: "human", people: "human", trusts: "trust", relies: "trust", rely: "trust" };
  function keywords(text) {
    return String(text || "").toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; });
  }
  function stem(w) { w = SYN[w] || w; return w.replace(/(ing|ed|es|s|ly|ful|ness)$/, "").slice(0, 5); }
  function evaluateMeaning(meaningText, heardText) {
    var keys = keywords(meaningText), heard = keywords(heardText).map(stem);
    var uniq = []; keys.forEach(function (k) { if (uniq.indexOf(k) < 0) uniq.push(k); });
    var hit = [], miss = [];
    uniq.forEach(function (k) { (heard.indexOf(stem(k)) >= 0 ? hit : miss).push(k); });
    var score = uniq.length ? Math.round(100 * hit.length / uniq.length) : 0;
    return { score: score, hit: hit, missing: miss, message: score >= 80 ? "You carried the meaning. MashaAllah." : score >= 50 ? "Most of the meaning is there. Missing: " + miss.join(", ") + "." : "Read the meaning once more, then say it in your own words. Key ideas: " + uniq.slice(0, 6).join(", ") + "." };
  }

  return { normalizeWord: normalizeWord, tokenize: tokenize, align: align, transliterate: transliterate, makhrajNotes: makhrajNotes, tajweedHints: tajweedHints, evaluate: evaluate, renderTranscript: renderTranscript, evaluateMeaning: evaluateMeaning, letterName: letterName, MAKHRAJ: MAKHRAJ };
});

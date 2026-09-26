/* Sukoon native adapter.
   Runs the same code on the web and inside the Capacitor app.
   On the web every call falls back to browser APIs. */
window.Native = (function () {
  var C = window.Capacitor;
  var P = (C && C.Plugins) || {};
  var isNative = !!(C && C.isNativePlatform && C.isNativePlatform());
  var platform = (C && C.getPlatform) ? C.getPlatform() : "web";

  /* ---- Fill these in after creating the app in RevenueCat ---- */
  var REVENUECAT_KEYS = { android: "", ios: "" };
  var ENTITLEMENT = "supporter";

  function getStored(key) {
    if (P.Preferences) return P.Preferences.get({ key: key }).then(function (r) { return r.value; });
    return new Promise(function (res) { try { res(localStorage.getItem(key)); } catch (e) { res(null); } });
  }
  function setStored(key, value) {
    if (P.Preferences) return P.Preferences.set({ key: key, value: value });
    return new Promise(function (res) { try { localStorage.setItem(key, value); } catch (e) {} res(); });
  }

  function haptic(kind) {
    try {
      if (P.Haptics) {
        if (kind === "tap") P.Haptics.impact({ style: "LIGHT" });
        else if (kind === "success") P.Haptics.notification({ type: "SUCCESS" });
        else P.Haptics.impact({ style: "MEDIUM" });
      } else if (navigator.vibrate) {
        navigator.vibrate(kind === "tap" ? 10 : kind === "success" ? [30, 40, 30] : 25);
      }
    } catch (e) {}
  }

  function parseTime(t) { var a = (t || "08:00").split(":"); return { hour: +a[0] || 0, minute: +a[1] || 0 }; }

  /* Schedules two repeating daily reminders inside the native app.
     Returns "native" when scheduled, "denied" when the user refused, "web" on the web. */
  function scheduleReminders(on, morning, evening) {
    if (!P.LocalNotifications) return Promise.resolve("web");
    var LN = P.LocalNotifications;
    return LN.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(function () {}).then(function () {
      if (!on) return "off";
      return LN.requestPermissions().then(function (perm) {
        if (perm.display !== "granted") return "denied";
        var m = parseTime(morning), e = parseTime(evening);
        return LN.schedule({ notifications: [
          { id: 1, title: "Sukoon", body: "Good morning. One thing you are thankful for?", schedule: { on: { hour: m.hour, minute: m.minute }, allowWhileIdle: true } },
          { id: 2, title: "Sukoon", body: "Before you sleep: three small gifts from today.", schedule: { on: { hour: e.hour, minute: e.minute }, allowWhileIdle: true } }
        ] }).then(function () { return "native"; });
      });
    });
  }

  /* ---- Purchases (RevenueCat) ---- */
  var purchasesReady = false;
  function purchasesAvailable() { return !!P.Purchases && !!REVENUECAT_KEYS[platform]; }
  function configurePurchases() {
    if (!purchasesAvailable() || purchasesReady) return Promise.resolve(purchasesReady);
    return P.Purchases.configure({ apiKey: REVENUECAT_KEYS[platform] }).then(function () { purchasesReady = true; return true; }).catch(function () { return false; });
  }
  function hasEntitlement(info) { return !!(info && info.entitlements && info.entitlements.active && info.entitlements.active[ENTITLEMENT]); }
  function isSupporter() {
    return configurePurchases().then(function (ok) {
      if (!ok) return null; /* null means: unknown, use local flag */
      return P.Purchases.getCustomerInfo().then(function (r) { return hasEntitlement(r.customerInfo || r); }).catch(function () { return null; });
    });
  }
  function getOfferings() {
    return configurePurchases().then(function (ok) {
      if (!ok) return [];
      return P.Purchases.getOfferings().then(function (r) {
        var cur = r.current || (r.offerings && r.offerings.current);
        return (cur && cur.availablePackages) || [];
      }).catch(function () { return []; });
    });
  }
  function buy(pkg) {
    return P.Purchases.purchasePackage({ aPackage: pkg }).then(function (r) { return hasEntitlement(r.customerInfo); });
  }
  function restore() {
    return P.Purchases.restorePurchases().then(function (r) { return hasEntitlement(r.customerInfo || r); }).catch(function () { return false; });
  }

  /* ---- Speech recognition (for Recite mode) ----
     Native: @capacitor-community/speech-recognition. Web: the browser's SpeechRecognition.
     Neither is available everywhere, so the app always offers a typing fallback. */
  var webRec = null, lastPartial = "", stopping = false, finalCb = null, finalized = false;
  function finish(t) { if (finalized) return; finalized = true; if (finalCb) finalCb(String(t || "").trim()); }
  function speechKind() {
    if (P.SpeechRecognition) return P.SpeechRecognition.available().then(function (r) { return r && r.available ? "native" : "none"; }).catch(function () { return "none"; });
    var W = window.SpeechRecognition || window.webkitSpeechRecognition;
    return Promise.resolve(W ? "web" : "none");
  }
  function speechStart(lang, onPartial, onFinal, onError) {
    lastPartial = ""; stopping = false; finalCb = onFinal; finalized = false;
    if (P.SpeechRecognition) {
      var SR = P.SpeechRecognition;
      return SR.requestPermissions().then(function (perm) {
        var ok = !perm || !perm.speechRecognition || perm.speechRecognition === "granted";
        if (!ok) { onError("denied"); return false; }
        return SR.removeAllListeners().catch(function () {}).then(function () {
          SR.addListener("partialResults", function (data) { var t = (data && data.matches && data.matches[0]) || ""; if (t) { lastPartial = t; onPartial(t); } });
          SR.addListener("listeningState", function (data) { if (data && data.status === "stopped") finish(lastPartial); });
          return SR.start({ language: lang, maxResults: 3, partialResults: true, popup: false });
        }).then(function (r) { var t = (r && r.matches && r.matches[0]) || ""; if (t) { lastPartial = t; finish(t); } return true; })
          .catch(function (e) { onError(String((e && e.message) || e)); return false; });
      });
    }
    var W = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!W) { onError("unsupported"); return Promise.resolve(false); }
    try {
      webRec = new W(); webRec.lang = lang; webRec.interimResults = true; webRec.continuous = true; webRec.maxAlternatives = 1;
      var finalText = "";
      webRec.onresult = function (ev) { var interim = ""; for (var i = ev.resultIndex; i < ev.results.length; i++) { var t = ev.results[i][0].transcript; if (ev.results[i].isFinal) finalText += t + " "; else interim += t; } lastPartial = (finalText + interim).trim(); onPartial(lastPartial); };
      webRec.onerror = function (ev) { onError(ev.error || "error"); };
      webRec.onend = function () { finish(finalText || lastPartial); };
      webRec.start(); return Promise.resolve(true);
    } catch (e) { onError("error"); return Promise.resolve(false); }
  }
  function speechStop() {
    stopping = true;
    if (P.SpeechRecognition) { return P.SpeechRecognition.stop().catch(function () {}).then(function () { setTimeout(function () { finish(lastPartial); }, 600); return lastPartial; }); }
    try { if (webRec) webRec.stop(); } catch (e) { finish(lastPartial); }
    return Promise.resolve(lastPartial);
  }

  return {
    isNative: isNative, platform: platform,
    get: getStored, set: setStored, haptic: haptic,
    scheduleReminders: scheduleReminders,
    purchases: { available: purchasesAvailable, isSupporter: isSupporter, offerings: getOfferings, buy: buy, restore: restore },
    speech: { kind: speechKind, start: speechStart, stop: speechStop }
  };
})();

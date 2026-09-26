# QuranLife
Living by Quran — daily purpose and gratitude. App name inside the stores: Sukoon.

## Native app project

This folder is a complete Capacitor project. The Android project is already generated inside `android/` with all icons and splash screens. iOS is generated on a Mac with one command.

```
sukoon-app/
  www/                  the app itself (index.html, native.js, icons, audio/)
  android/              ready to open in Android Studio
  resources/            source icon and splash images
  store/                Play Store and App Store listing text, privacy policy
  capacitor.config.json app id, name, splash and notification settings
  package.json          plugins and scripts
```

## 1. First-time setup on your computer

Install once: Node.js 20+, Android Studio (with an Android SDK and an emulator or your phone in USB debugging mode). For iOS you also need a Mac with Xcode 15+ and CocoaPods.

```
cd sukoon-app
npm install
npx cap sync
```

`node_modules` is not in the zip. `npm install` recreates it in a minute.

## 2. Run on your Android phone

```
npm run android        # opens Android Studio
```

In Android Studio: wait for Gradle to finish, pick your phone in the device list, press Run. First build takes 5 to 10 minutes. After that, every time you change anything in `www/` run `npx cap sync` and press Run again.

## 3. Things to fill in before release

| What | Where | Why |
|---|---|---|
| RevenueCat API keys | `www/native.js`, top: `REVENUECAT_KEYS` | Without them the app shows the free-preview paywall |
| Recitation audio | `www/audio/` (see README.txt there) | Listen button plays bundled audio |
| Privacy policy URL | `store/privacy-policy.html`, host it anywhere public | Both stores require a URL |
| Version | `android/app/build.gradle` versionCode and versionName | Bump for every upload |
| Package name | Already `com.sukoon.app`. Change only before first upload, never after | Stores lock it |
| iOS microphone text | `ios/App/App/Info.plist` after `cap add ios`: add `NSMicrophoneUsageDescription` ("Sukoon listens to your recitation to check it word by word") and `NSSpeechRecognitionUsageDescription` (same text) | Apple rejects the build without them |

## 3b. Recite mode (Quran Live)

Every verse has a Recite button. The reciter taps the mic, recites, taps again. The app transcribes with the phone's speech recognizer (Arabic `ar-SA`, or English for "Say the meaning"), aligns the words with the verse, and marks wrong, skipped and extra words in red. For every red word it shows the correct word, a pronunciation guide, the articulation point of the letters which differ, and the Tajweed rules present in that word. Where the microphone is blocked, a typing box does the same check.

Files: `www/recite-engine.js` (pure logic, tested by `tests/engine.test.js`) and the Recite section in `www/index.html`. Speech capture lives in `www/native.js` (`Native.speech`), which uses `@capacitor-community/speech-recognition` on phones and the browser's SpeechRecognition on the web.

Honest limits, say them in your store listing too: speech recognizers return letters, not articulation, so makhraj and harakat mistakes which produce the same letters are not caught. Word accuracy is measured. Articulation and rules are taught from the verse text.

## 3c. Tests

```
npm run test:engine     # 63 checks on normalization, alignment, transliteration, tajweed hints, fuzzing
npm run test:ui         # headless Chromium: every screen, sheet and the Recite flow, 6 passes, two widths, both themes
npm test                # both
```
The UI test needs Python 3 with `playwright` installed (`pip install playwright && playwright install chromium`).

## 4. Build the release for Google Play

1. Create the upload key once. Back it up in two places. Losing it means you can never update the app.
   ```
   keytool -genkey -v -keystore sukoon-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sukoon
   ```
2. In Android Studio: Build → Generate Signed Bundle / APK → Android App Bundle → choose the keystore → release. Output: `android/app/release/app-release.aab`.
3. Play Console (play.google.com/console, USD 25 once): Create app → fill the store listing from `store/listing.md` → upload the .aab to Closed testing first.
4. New personal accounts: 12 testers opted in for 14 continuous days, then apply for production. Recruit the testers now.
5. Data safety form: data is stored on device, nothing collected, no third-party sharing (until you add analytics or RevenueCat, then declare "purchase history" as collected by the payment processor).
6. Content rating: fill the questionnaire honestly, it lands at Everyone or Teen.

## 5. Build for the App Store (Mac only)

```
npm run add:ios        # once
npx cap sync
npm run ios            # opens Xcode
```

In Xcode: Signing & Capabilities → pick your team → add the Push Notifications capability is NOT needed (local notifications only). Set the bundle id to `com.sukoon.app`. Product → Archive → Distribute App → App Store Connect. Then in appstoreconnect.apple.com fill the listing from `store/listing.md`, age rating 12+, privacy nutrition labels: Data Not Collected (until purchases: then "Purchases" linked to identity: No).

Apple review usually takes 1 to 3 days. A first rejection is normal, they tell you exactly why.

## 6. Subscriptions (RevenueCat)

1. Create the two products in Play Console (Monetize → Subscriptions): `sukoon_monthly` and `sukoon_yearly`. Same names in App Store Connect under a subscription group called Supporter.
2. revenuecat.com → new project → add Android app and iOS app → paste the store credentials they ask for.
3. Entitlement: `supporter`. Attach both products. Offering: default, with both packages (Monthly and Annual).
4. Copy the public API keys into `www/native.js` → `REVENUECAT_KEYS`.
5. `npx cap sync` and rebuild. The Supporter sheet now loads real prices and buys through the store. Restore purchases is already wired.

Blocker to check first: Google Play merchant accounts are not offered in every country. If Pakistan is not on the list, sell through a company registered in a supported country or ship iOS-only payments first.

## 7. Updating the app later

Edit `www/index.html`. Run `npx cap sync`. Rebuild. Bump versionCode. Upload. That is the whole loop.

## 8. Test the web version locally

```
npm run serve
```
then open http://localhost:5173 on your phone (same Wi-Fi) or computer.

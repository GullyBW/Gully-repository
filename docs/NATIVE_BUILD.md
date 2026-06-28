# Native build guide (Android & iOS)

The Ionic app is Capacitor-ready (`mobile/capacitor.config.ts`, appId
`bw.co.tirelo.app`). The native projects are generated locally (they are not
committed) and require platform toolchains.

## Prerequisites

- Node 20, `npm ci` in `mobile/`
- Android: Android Studio + SDKs, JDK 17
- iOS: macOS + Xcode + CocoaPods

## One-time setup

```bash
cd mobile
npm i -D @capacitor/cli
npm i @capacitor/android @capacitor/ios
npx ng build --configuration production      # produces www/
npx cap add android
npx cap add ios
npx cap sync
```

## Firebase / push

- Android: copy `google-services.json` → `mobile/android/app/`.
- iOS: copy `GoogleService-Info.plist` → `mobile/ios/App/App/`; in Xcode enable
  **Push Notifications** + **Background Modes → Remote notifications**.
- See `docs/FIREBASE.md` for full FCM/APNs setup.

## Deep links

- Custom scheme `tirelo://` and universal/app links are handled by
  `DeepLinkService` (listens to `appUrlOpen` and notification `data`).
- Android: add an `intent-filter` for your domain in `AndroidManifest.xml`.
- iOS: add Associated Domains (`applinks:app.tirelo.example.com`).

## Icons & splash

```bash
cd mobile
npm i -D @capacitor/assets
# Provide resources/icon.svg (1024x1024) and resources/splash.svg (2732x2732)
npx capacitor-assets generate    # writes adaptive icons + splash for both platforms
```

A starter `mobile/resources/icon.svg` is included. Replace with final brand art.

## Release builds

### Android

```bash
cd mobile/android
./gradlew bundleRelease     # AAB for Play Store (configure signing in app/build.gradle)
```

Configure a keystore and `signingConfigs` (placeholders documented in the
generated `app/build.gradle`). Upload the `.aab` to Google Play Console.

### iOS

Open `mobile/ios/App/App.xcworkspace` in Xcode, set the team/bundle id, then
**Product → Archive** and distribute to App Store Connect.

## Live reload during development

```bash
npx cap run android -l --external
npx cap run ios -l --external
```

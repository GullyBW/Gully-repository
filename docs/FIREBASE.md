# Firebase & Google Maps configuration

This guide covers Firebase Cloud Messaging (push) and Google Maps for Tirelo
Services. Both are **optional** — without keys the backend uses console/sandbox
fallbacks — but required for production push and live maps.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Add apps:
   - **Android**: package name `bw.co.tirelo.app` → download `google-services.json`.
   - **iOS**: bundle id `bw.co.tirelo.app` → download `GoogleService-Info.plist`.

## 2. Cloud Messaging (server)

1. Project settings → **Service accounts** → *Generate new private key*.
2. Provide it to the API as `FCM_SERVICE_ACCOUNT` (path or raw JSON) and set
   `PUSH_TRANSPORT=fcm`. Install the optional dep: `npm i firebase-admin`.
3. The backend already exposes device registration (`POST /api/notifications/devices`)
   and dispatches via `PushService`; no code changes needed.

## 3. Android configuration

1. Place `google-services.json` in `mobile/android/app/`.
2. The `@capacitor/push-notifications` plugin registers automatically; default
   notification channel is created on first run. Add custom channels in
   `MainActivity` if needed.
3. **SHA certificates** (for App Links / Google sign-in):
   `cd mobile/android && ./gradlew signingReport` → add SHA-1 and SHA-256 to the
   Firebase Android app.

## 4. iOS configuration

1. Place `GoogleService-Info.plist` in `mobile/ios/App/App/`.
2. Enable **Push Notifications** and **Background Modes → Remote notifications**
   capabilities in Xcode.
3. **APNs**: create an APNs Auth Key (.p8) in the Apple Developer portal and
   upload it in Firebase → Cloud Messaging → Apple app configuration.

## 5. Google Maps API keys

1. Google Cloud console → enable **Maps JavaScript, Geocoding, Places,
   Directions, Distance Matrix** APIs.
2. Backend: set `GOOGLE_MAPS_API_KEY` (used by `GeoService` for geocoding /
   places / directions). Without it the Botswana sandbox is used.
3. Frontend (optional JS SDK): set `googleMapsApiKey` in
   `mobile/src/environments/environment*.ts`.
4. Restrict keys (HTTP referrers for web, app restrictions for Android/iOS).

## 6. Testing notifications

- Backend health: send a booking and confirm a `new_booking` notification via
  `GET /api/notifications`.
- Device push: register a token, then use Firebase console → *Cloud Messaging →
  Send test message* with the device token.
- Deep links: send a data payload with `type` + `bookingReference`; tapping it
  routes via `DeepLinkService` (see `docs/NATIVE_BUILD.md`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No token on device | Check notification permission was granted; verify `google-services.json` / plist are present and bundle ids match. |
| Push not delivered | Confirm `PUSH_TRANSPORT=fcm`, valid service account, and the device token reached `POST /api/notifications/devices`. |
| iOS no push | APNs key uploaded to Firebase? Push capability + background mode enabled? |
| Maps empty / sandbox data | `GOOGLE_MAPS_API_KEY` missing or APIs not enabled / key restricted. |
| `firebase-admin` not found | It is an optional dependency — `npm i firebase-admin` on the server. |

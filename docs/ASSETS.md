# Production assets

This project ships a master SVG logo; binary assets (PNG icons, splash screens,
store graphics) are generated from it with tooling rather than committed.

## Source art
- `mobile/resources/icon.svg` — 1024×1024 app icon master (replace with final brand art).
- For splash, add `mobile/resources/splash.svg` (2732×2732, logo centred on brand background).

## App icons & splash (Android + iOS + PWA)

```bash
cd mobile
npm i -D @capacitor/assets
npx capacitor-assets generate            # generates adaptive icons, splash, PWA icons
```

This produces:
- Android adaptive icons (`android/app/src/main/res/mipmap-*`)
- iOS icons + launch storyboard (`ios/App/App/Assets.xcassets`)
- PWA icons referenced by `mobile/src/manifest.webmanifest`
  (`assets/icon/icon-192.png`, `assets/icon/icon-512.png`)

> Until generated, the manifest's PNG icon references 404 in the browser; run the
> command above (or drop the two PNGs in `mobile/src/assets/icon/`) before release.

## Favicon
`mobile/src/assets/favicon.svg` is referenced from `index.html`. Provide a
`favicon.ico` as well for legacy browsers if desired.

## Notification icons
- Android: a white, transparent small icon (`ic_stat_notify`) in
  `android/app/src/main/res/drawable-*`. Set the FCM default in
  `AndroidManifest.xml`.
- iOS uses the app icon.

## Store graphics (produce per store spec)
- Google Play: feature graphic 1024×500, phone/tablet screenshots, 512×512 icon.
- App Store: 1290×2796 (and other device) screenshots, 1024×1024 marketing icon.
- Provide light and dark screenshot variants where the app theme differs.

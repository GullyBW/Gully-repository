# CI/CD guide

Workflows live in `.github/workflows/`.

## `ci.yml` — on every push / PR

| Job | What it does |
| --- | --- |
| `backend` | `npm ci` + `npm test` (Jest, in-memory repos) |
| `e2e` | Playwright **API** journeys (`playwright.config.ts`) — uploads `playwright-report` |
| `ui-e2e` | Builds the PWA (dev config) + Playwright **browser** journeys (`playwright.ui.config.ts`) — uploads `playwright-report-ui` |
| `mobile` | Ionic production build |
| `docker` | Builds the API Docker image |

## `release.yml` — on `main` / manual

| Job | What it does |
| --- | --- |
| `security` | `npm audit` (prod deps) + gitleaks secret scan |
| `codeql` | CodeQL static analysis (JS/TS) |
| `image` | Build & push API image to GHCR (`:latest`, `:<sha>`) |
| `tag` | Auto-tag `vX.Y.Z` from `package.json` |
| `deploy` | Deploy to `staging`/`production` (placeholder — wire your infra command) |

## `native.yml` — on tags / manual

| Job | Runner | What it does |
| --- | --- | --- |
| `android` | ubuntu | Build PWA → `cap add android` → `gradlew bundleRelease` (signs if secrets set) → upload `.aab` |
| `ios` | macOS | Build PWA → `cap add ios` → unsigned `xcodebuild` (real distribution needs signing) |

## Required secrets

| Secret | Used by |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android signing |
| (Apple signing certs / provisioning) | iOS distribution (via fastlane match or Xcode Cloud) |
| `GITHUB_TOKEN` | GHCR push (provided automatically) |

## Local equivalents

```bash
npm test                 # backend
npm run test:e2e         # API E2E
npm run test:e2e:ui      # browser E2E (build mobile dev first)
cd mobile && npx ng build --configuration production
docker build -t tirelo-api .
```

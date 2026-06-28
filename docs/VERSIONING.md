# Versioning strategy

## Semantic versioning

The platform follows **SemVer** (`MAJOR.MINOR.PATCH`):
- **MAJOR** — breaking API/schema changes (avoided; see compatibility policy).
- **MINOR** — backward-compatible features (most releases).
- **PATCH** — backward-compatible fixes.

`package.json` `version` is the source of truth; the `release.yml` workflow tags
`vX.Y.Z` automatically on `main` when the version changes.

## API compatibility policy

- **Additive only.** New endpoints/fields are added; existing request/response
  shapes and the `{ success, data }` envelope are never broken.
- The payment module is frozen — no contract changes.
- If a breaking change ever becomes necessary, introduce a versioned prefix
  (`/api/v2/...`) and run both versions during a deprecation window.

## Database schema policy

- Migrations are **additive** (new optional fields with defaults), so old and new
  app versions interoperate during rolling deploys and rollbacks.

## Mobile app versioning

- User-facing version = `package.json` version (`mobile/package.json`).
- Android `versionCode` and iOS `CFBundleVersion` are **monotonic build numbers**
  — set from CI (`github.run_number`) in `native.yml`, independent of SemVer.
- Keep the PWA, Android and iOS on the same marketing version per release.

## Changelog

Maintain `CHANGELOG.md` (Keep a Changelog format). Each release lists Added /
Changed / Fixed / Security. Tag the release and attach the AAB / build artifacts.

## Branching

- `main` is always deployable; feature branches → PR → CI green → merge.
- Tags trigger native builds and (optionally) production deploys.

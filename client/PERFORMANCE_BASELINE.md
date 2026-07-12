# Performance Baseline

Production measurements are generated with `npm run build --prefix client` and enforced with
`npm run performance:check --prefix client`.

## Current Build

| Metric | Result | Budget |
| --- | ---: | ---: |
| Largest JavaScript chunk | 465.2 KiB | 500 KiB |
| Total JavaScript | 1971.4 KiB | 2100 KiB |
| Largest stylesheet | 384.9 KiB | 420 KiB |
| Main Firebase chunk | 236.2 KiB | Included above |
| Deferred Analytics chunk | 18.7 KiB | Loaded only when enabled and supported |

The previous main Firebase chunk was 263.7 KiB. Lazy-loading optional Analytics and Storage
reduced the startup Firebase chunk by about 10 percent. AVIF and WebP hero/logo assets remain
the preferred formats, with PNG files retained as compatibility fallbacks.

## Loading Boundaries

- Customer, owner, staff, and rider workspaces are separate lazy chunks.
- Maps, charts, camera proof, PDF generation, and HTML-to-canvas support load only on relevant screens.
- Firebase Analytics loads asynchronously and cannot block startup.
- Firebase Storage loads only when `VITE_ENABLE_FIREBASE_STORAGE=true`; the free-first setup keeps it disabled.
- The hero AVIF is preloaded because it is the first-viewport background.

## Guardrail

`client/scripts/check-bundle-budget.mjs` fails when a generated asset exceeds the measured
limits. Raise a budget only with a recorded reason and a new before/after build measurement.

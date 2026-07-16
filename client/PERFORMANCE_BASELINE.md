# Performance Baseline

Production measurements are generated with `npm run build --prefix client` and enforced with
`npm run performance:check --prefix client`.

## Current Build

| Metric | Result | Budget |
| --- | ---: | ---: |
| Initial application chunk | 360.2 KiB | 500 KiB |
| Largest deferred JavaScript chunk (jsPDF) | 377.0 KiB | 500 KiB |
| Total JavaScript | 1868.7 KiB | 2100 KiB |
| Largest stylesheet | 392.2 KiB | 420 KiB |
| Main Firebase chunk | 236.2 KiB | Included above |
| Deferred Analytics chunk | 18.7 KiB | Loaded only when enabled and supported |

Before this update, the initial application chunk was about 472.2 KiB and total JavaScript was
1978.4 KiB. Removing GSAP from the public landing startup path reduced the initial chunk by about
24 percent and total JavaScript by about 6 percent. Lazy-loading optional Analytics and Storage
keeps them outside the initial Firebase chunk. AVIF and WebP hero/logo assets remain the preferred
formats, with PNG files retained as compatibility fallbacks.

## Mobile Lighthouse

The production preview audit improved Performance from 59 to 69. Accessibility, Best Practices,
and SEO each score 100. The latest simulated metrics are 2.9 s FCP, 7.2 s LCP, 170 ms total
blocking time, and 0 cumulative layout shift. Lighthouse is a variable synthetic measurement, so
the bundle budgets remain the deterministic CI guardrail.

## Loading Boundaries

- Customer, owner, staff, and rider workspaces are separate lazy chunks.
- Maps, charts, camera proof, PDF generation, and HTML-to-canvas support load only on relevant screens.
- Firebase Analytics loads during browser idle time or on the first conversion event and cannot block startup.
- Firebase Storage loads only when `VITE_ENABLE_FIREBASE_STORAGE=true`; the free-first setup keeps it disabled.
- The hero AVIF is preloaded because it is the first-viewport background.

## Guardrail

`client/scripts/check-bundle-budget.mjs` fails when a generated asset exceeds the measured
limits. Raise a budget only with a recorded reason and a new before/after build measurement.

# Performance Baseline

Captured before the React lazy optimization phases.

## Production Build Chunks

| Asset | Size |
| --- | ---: |
| `assets/index-DrC_COXx.js` | 464.55 kB |
| `assets/jspdf.es.min-BzEbtcEW.js` | 386.08 kB |
| `assets/index-DR4JAvw0.css` | 307.82 kB |
| `assets/firebase-Cqn7PR5U.js` | 270.88 kB |
| `assets/html2canvas.esm-DXEQVQnt.js` | 201.04 kB |
| `assets/maps-CGbYbgTA.js` | 165.54 kB |
| `assets/charts-CJDeJeqS.js` | 164.85 kB |
| `assets/index.es-BRL8-Tez.js` | 158.92 kB |
| `assets/purify.es-Da2JFxT4.js` | 27.96 kB |

## Initial Findings

- `client/src/App.jsx` is a large all-in-one entry component.
- Map, chart, and camera components are imported at app startup.
- Bootstrap JavaScript and Leaflet CSS are loaded globally.
- Role-specific screens are rendered from one module instead of lazy chunks.

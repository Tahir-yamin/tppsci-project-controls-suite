# TPPSCI — Project Planning, Scheduling & Control Intelligence

[![CI](https://github.com/Tahir-yamin/tppsci-project-controls-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Tahir-yamin/tppsci-project-controls-suite/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6)
![Vite](https://img.shields.io/badge/Vite-8-646CFF)
![Privacy](https://img.shields.io/badge/privacy-100%25%20client--side-16a34a)

A browser-based project controls suite for Primavera P6 planners, delay analysts and
schedule assurance teams. Load an `.xer` export and get a Gantt, a real DCMA 14-point
assessment, and a Monte Carlo schedule risk analysis — computed locally, with nothing
uploaded anywhere.

---

## What it actually does

Everything below is computed from the file you load. Where a check cannot be evaluated
from a single XER, the tool says so and marks it **N/A** rather than quietly passing it.

### XER viewer & Gantt
Split-pane Gantt with a WBS tree, timeline scaled to the schedule's own date range
(month / week / day zoom), a data-date line read from `PROJECT.last_recalc_date`,
progress-filled bars, milestone diamonds from `task_type`, and filters for status,
criticality, milestones and total float. Exports the filtered set to CSV.

### DCMA 14-point assessment
All 14 checks computed from the loaded schedule:

| # | Check | How it is measured |
|---|-------|--------------------|
| 1 | Logic | Incomplete activities missing a predecessor or successor, excluding the one legitimate project start and finish |
| 2 | Leads | Relationships with negative lag |
| 3 | Lags | Relationships with positive lag |
| 4 | Relationship types | Share of Finish-to-Start links |
| 5 | Hard constraints | Incomplete activities carrying a logic-overriding constraint |
| 6 | High float | Total float above the configured horizon (default 44 wd) |
| 7 | Negative float | Activities behind their own logic |
| 8 | High duration | Remaining duration above the horizon, milestones excluded |
| 9 | Invalid dates | Forecast work before the data date, or actuals after it |
| 10 | Resources | Duration-bearing activities with no `TASKRSRC` assignment |
| 11 | Missed tasks | Planned to finish by the data date but did not |
| 12 | Critical path test | Critical activities that connect to no other critical activity |
| 13 | CPLI | `(critical path length + project total float) / critical path length` |
| 14 | BEI | Activities complete ÷ activities planned complete by the data date |

RAG bands, the hours-per-day divisor and the float/duration horizon are all editable
in **Thresholds & settings**, and the results recompute live. Click any check to drill
into the flagged activities; export any list or the whole report to CSV.

### Schedule risk analysis (QSRA, screening grade)
A seeded Monte Carlo simulation over a real CPM engine:

- **Every iteration re-solves the network** — forward and backward pass — so the
  criticality index is *measured* (how often each activity actually landed on the
  critical path), not assumed from the deterministic run.
- **Beta-PERT or triangular** duration sampling from configurable optimistic /
  most-likely / pessimistic percentages.
- **Sensitivity** is the correlation between each activity's sampled duration and the
  project finish, computed with running sums so memory stays flat regardless of
  iteration count.
- **Reproducible**: the same seed always yields the same result.
- Outputs P10/P50/P80/P90 dates, the confidence your deterministic date actually
  carries, an S-curve with the iteration histogram, ranked drivers, a CSV export and
  a PDF summary.

The engine reports its own limitations rather than hiding them: open ends, circular
logic, leads and lags held fixed, and how far its CPM finish sits from the dates in
your file.

### Longest path analyser
Traces the driving chain backwards from the last-finishing activity, following the
predecessor that actually sets each early start — which is not always the same as
everything P6 tags with zero float.

### Schedule mentor
Rule-by-rule guidance on logic, constraints, calendars, progress and structure, each
one listing the activities in *your* schedule that trip it.

### XER anonymiser
Pseudonymises project, WBS, activity and resource names while preserving the
analytical skeleton (logic, dates, float, calendars), and re-emits a valid `.xer`.

### Prototype modules
These tabs demonstrate the intended workflow but are **not yet computed from the
loaded schedule**, and say so in the UI:
Schedule Comparison · Progress Roll-Up · Time–Chainage · MS Project Fixer.

---

## Privacy

Parsing, CPM, simulation, anonymisation and every export run inside your browser. There
is no backend and no telemetry. The shipped `Content-Security-Policy` sets
`connect-src 'self'`, so the page cannot make outbound requests even if it wanted to.

---

## Running locally

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Tahir-yamin/tppsci-project-controls-suite.git
cd tppsci-project-controls-suite
npm install
npm run dev          # http://localhost:5173
```

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the production build on port 4173 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (CPM, DCMA, Monte Carlo, parser, sample data) |

---

## Deploying

### Vercel

The repo ships a `vercel.json` with the framework preset, cache headers and security
headers already configured.

```bash
npm i -g vercel
vercel            # preview deployment
vercel --prod     # production
```

Or import the repository at [vercel.com/new](https://vercel.com/new) — the defaults are
picked up from `vercel.json`, so no dashboard configuration is needed.

Because `vite.config.ts` sets `base: './'`, the same build also works when served from
a sub-path.

### RunPod

The `Dockerfile` produces a small nginx image serving the static build, listening on
`$PORT` (default `8080`).

```bash
docker build -t tppsci .
docker run --rm -p 8080:8080 tppsci      # http://localhost:8080
```

To run it on RunPod:

1. Push the image to a registry:
   ```bash
   docker build -t <registry>/<user>/tppsci:latest .
   docker push <registry>/<user>/tppsci:latest
   ```
2. Create a **Pod** (a CPU pod is plenty — this app does no GPU work) from that image.
3. Expose **HTTP port `8080`**.
4. Open the generated `https://<pod-id>-8080.proxy.runpod.net` URL.

No environment variables or volumes are required; set `PORT` only if you need to
serve on a different port.

> This is a static client-side app, so a GPU pod would be wasted spend. Vercel or any
> static host is the cheaper default; RunPod makes sense when you want it running
> inside an environment you already control.

### Any other static host

`npm run build` emits a self-contained `dist/` — upload it anywhere (S3, Netlify,
Cloudflare Pages, GitHub Pages, an internal nginx).

---

## Architecture

```
src/
  cpm.ts             CPM engine: network build, topological sort, forward/backward
                     passes, allocation-free hot loop, seeded PRNG
  dcmaEngine.ts      DCMA 14-point checks, Monte Carlo simulation, XER anonymiser
  xerParser.ts       Tab-delimited XER reader (%T / %F / %R records)
  sampleData.ts      Three demo schedules, generated from a spec and then *scheduled*
                     so their dates, float and progress are internally consistent
  scheduleMentorData.ts  Mentor rules and their detection predicates
  main.ts            UI rendering and wiring
  style.css          Design tokens, light/dark themes, components
  cpm.test.ts        Unit tests
```

The CPM engine is deliberately calendar-free: it solves on a continuous hour scale and
calibrates the hour-to-calendar factor against the schedule's own start-to-finish span.
That makes it screening grade — good for ranking risk drivers and comparing scenarios,
not a replacement for a P6 recalculation. The UI states this where it matters.

---

## Author

**Tahir Yamin** — Lead Developer & Project Controls Architect
[tahiryamin2050@gmail.com](mailto:tahiryamin2050@gmail.com)

## License

[MIT](LICENSE)

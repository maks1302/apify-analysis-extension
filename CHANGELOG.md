# Changelog

Notable project changes are documented here.

## 0.28.0 — 2026-09-26

- Added a live recent-run inspector below Run activity that samples each selected
  Actor's latest 200 runs and classifies all outcomes locally.
- Added direct Apify run links, exit codes, duration, build, result and compute
  usage, resource samples, and concise diagnostic signals.
- Limited recent-run loading to one request per selected Actor, shared by all
  status tabs, and stopped failed requests from entering an automatic retry loop.
- Kept recent-run data memory-only and removed user IDs, worker IPs, and internal
  runtime identifiers before passing data to the dashboard.
- Fixed duplicate daily earnings caused by treating Apify Console's comma-separated
  multi-Actor profit request as an additional synthetic Actor series, and added
  automatic cleanup for previously stored aggregate series.
- Made Actor colors deterministic from the Actor ID so legends, stacked bars, and
  tooltips stay consistent across earnings, run activity, and user activity views.
- Added expandable Actor legends that highlight matching stacked segments on
  hover or keyboard focus. Every Actor now remains an individual chart segment,
  while daily tooltips rank the true contributors for the hovered day.
- Added compact per-day value labels above the bars while an Actor is highlighted
  from the legend, using currency or count formatting for the active chart.

## 0.27.0 — 2026-09-24

- Published Actor Analytics for Apify (by MintAPI) in the Chrome Web Store.
- Added portfolio overview, daily financial stacks, run and user activity,
  Actor performance, quality, and acquisition dashboards.
- Added month selection, Actor filtering, consolidated chart tooltips,
  fullscreen analysis, and synchronized light/dark themes.
- Added local-only privacy information, an Apify-only request boundary, and
  dependency-free Store marketing assets.

[Chrome Web Store listing](https://chromewebstore.google.com/detail/actor-analytics-for-apify/alhjjaafelbmfphijdidjodejcjiccef)

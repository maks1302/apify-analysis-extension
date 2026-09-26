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

## 0.27.0 — 2026-09-24

- Published Actor Analytics for Apify (by MintAPI) in the Chrome Web Store.
- Added portfolio overview, daily financial stacks, run and user activity,
  Actor performance, quality, and acquisition dashboards.
- Added month selection, Actor filtering, consolidated chart tooltips,
  fullscreen analysis, and synchronized light/dark themes.
- Added local-only privacy information, an Apify-only request boundary, and
  dependency-free Store marketing assets.

[Chrome Web Store listing](https://chromewebstore.google.com/detail/actor-analytics-for-apify/alhjjaafelbmfphijdidjodejcjiccef)

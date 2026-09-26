# Actor Analytics for Apify (by MintAPI)

An independent, local-first Chrome extension that adds advanced Actor analytics
directly to Apify Console.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/actor-analytics-for-apify/alhjjaafelbmfphijdidjodejcjiccef)
· [Report a bug](https://github.com/maks1302/apify-analysis-extension/issues/new)
· [Privacy policy](PRIVACY.md)

Actor Analytics helps Apify developers understand which Actors generate revenue,
which ones are growing, and which ones need attention. It is completely free,
contains no telemetry or advertising, and does not send analytics data to MintAPI.

> This project is not affiliated with, endorsed by, or sponsored by Apify.

## Why this exists

Apify's monetization chart is useful for portfolio totals, but managing multiple
Actors often requires a more detailed answer:

- Which Actor generated each day's revenue and profit?
- Which Actor caused a spike in failed, aborted, or timed-out runs?
- How are paying users, quality, and acquisition changing?
- How does each Actor compare with the previous month?

This extension brings those answers into one analysis workspace without exporting
data or connecting another analytics service.

## Features

- **Portfolio overview** — revenue, costs, profit, margin, pacing, alerts, and
  month-over-month Actor trends.
- **Daily earnings** — stacked revenue, profit, and cost contributions by Actor.
- **Run activity and inspector** — daily run outcomes by Actor plus a live,
  status-filtered view over each Actor's latest 200 runs with direct links, exit
  codes, resource usage, and diagnostic signals.
- **User activity** — daily paying, free, and total Actor-user occurrences.
- **Actor performance** — financial and reliability rankings with monthly trends.
- **Actor quality** — quality scores, ratings, reviews, bookmarks, praises, and
  recommended improvements.
- **Traffic and acquisition** — page views, run conversion signals, referrers,
  and countries.
- **Analysis controls** — month/year selection, Actor filtering, consolidated
  chart tooltips, light/dark themes, and fullscreen mode.

## Privacy and permissions

The extension deliberately requests only Chrome's `storage` permission and runs
only on `https://console.apify.com/*`.

- Normalized dashboard data is stored in `chrome.storage.local` on the user's
  device.
- Authentication context stays in page memory and is used only for requests to
  Apify's own Console backend.
- Authentication headers and tokens are never persisted by the extension.
- Recent-run details are kept only in page memory. User IDs, worker IPs, and
  internal runtime identifiers are discarded before the dashboard receives them.
- There is no telemetry, behavioral tracking, advertising, or third-party
  analytics SDK.
- No data is sent to MintAPI or another developer-controlled service.

See the full [privacy policy](PRIVACY.md) and [security policy](SECURITY.md).

## Install from source

Requirements: Google Chrome 111 or newer and an Apify account with Actor analytics.

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository directory.
5. Open [Apify Monetization](https://console.apify.com/actors/insights/monetization).
6. Reload the page once, then click **Analytics** in the chart header. A floating
   launcher is available as a fallback.

No build step, dependency installation, API key, or separate account is required.

## How it works

The extension uses two small, dependency-free scripts:

- `interceptor.js` runs in the page's main world. It observes the relevant Apify
  Console analytics responses and makes additional Actor-level requests using the
  active Apify session in memory.
- `content.js` normalizes the responses, stores dashboard data locally, and
  renders the interface defined by `styles.css`.

Extension-initiated analytics requests are restricted to HTTPS and
`console-backend.apify.com`. The original Apify responses are cloned and never
modified. The endpoints are internal to Apify and may change.

## Development

Run the dependency-free checks:

```bash
node scripts/check-release.mjs
```

Then load the repository as an unpacked extension and follow the manual checklist
in [CONTRIBUTING.md](CONTRIBUTING.md).

To create a clean Chrome Web Store ZIP containing runtime files only:

```bash
./scripts/package-extension.sh
```

The package is written to `dist/`. The script deliberately excludes `.git`,
documentation, marketing assets, local archives, and operating-system metadata.

## Store and marketing assets

- [Chrome Web Store publication notes](CHROME_WEB_STORE.md)
- [Capture-ready marketing layouts](store-assets.html)
- [Logo source](logo.svg)

The marketing page is a source asset and is not included in release packages.

## Contributing

Bug reports, focused feature proposals, and pull requests are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Security issues
should be reported privately according to [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).

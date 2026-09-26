# Chrome Web Store publication guide

This document contains ready-to-paste listing copy and a release checklist for
Actor Analytics for Apify (by MintAPI).

**Published listing:**
https://chromewebstore.google.com/detail/actor-analytics-for-apify/alhjjaafelbmfphijdidjodejcjiccef

## 1. Finish the extension icons

Chrome does not support SVG files as manifest icons. Export `logo.svg` as PNG
files with transparent backgrounds and save them as:

- `icons/icon16.png` — 16 × 16 px
- `icons/icon32.png` — 32 × 32 px
- `icons/icon48.png` — 48 × 48 px
- `icons/icon128.png` — 128 × 128 px

Then add this top-level property to `manifest.json`:

```json
"icons": {
  "16": "icons/icon16.png",
  "32": "icons/icon32.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

Keep the artwork legible at 16 px and avoid putting important details at the
outer edge of the 128 px canvas.

## 2. Store listing

### Product name

```text
Actor Analytics for Apify (by MintAPI)
```

### Summary

```text
Advanced local analytics for Apify Actors: revenue, profit, runs, users, quality, and acquisition in one dashboard.
```

### Detailed description

```text
Understand how your Apify Actors perform without exporting data or switching between multiple Console views.

Actor Analytics for Apify (by MintAPI) adds a private analytics workspace directly to Apify Console. It organizes the analytics available to your signed-in account into clear dashboards for financial performance, run reliability, users, quality, and acquisition.

KEY FEATURES

• Overview with portfolio revenue, costs, net profit, margin, performance alerts, and month-over-month Actor trends
• Daily stacked charts showing each Actor's contribution to revenue, profit, and costs
• Daily run activity for successful, failed, aborted, timed-out, total runs, and results
• Recent run inspector sampling each Actor's latest 200 runs, with direct Apify links, exit codes, resource usage, and diagnostic signals
• Daily paying and free user activity by Actor
• Actor performance rankings with revenue, profit, cost, usage, and reliability metrics
• Actor quality details including scores, ratings, reviews, bookmarks, praises, and suggested improvements
• Traffic and acquisition insights including page views, conversion signals, referrers, and countries
• Month and year selection, Actor filtering, rich chart tooltips, light/dark themes, and fullscreen analysis

PRIVACY BY DESIGN

The extension runs only on console.apify.com. It has no telemetry, advertising, or third-party analytics. Normalized dashboard data is stored locally in Chrome storage on your device. Authentication context is used only in page memory to request analytics from Apify's own Console backend and is never persisted by the extension or sent to the developer.

This is an independent extension and is not affiliated with, endorsed by, or sponsored by Apify.
```

### Category

```text
Developer Tools
```

### Language

```text
English
```

### Homepage URL

```text
https://github.com/maks1302/apify-analysis-extension
```

### Support URL

```text
https://github.com/maks1302/apify-analysis-extension/issues
```

### Privacy policy URL

The published listing currently uses:

```text
https://mintapi.dev/privacy
```

The repository also includes a product-specific [privacy policy](PRIVACY.md).
Keep the website policy, repository policy, Store disclosures, and implementation
consistent when data handling changes.

## 3. Privacy practices form

### Single purpose

```text
Provide Apify Actor owners with an on-device analytics dashboard that organizes their existing Apify Console monetization, run, user, quality, and acquisition data.
```

### `storage` permission justification

```text
The storage permission saves normalized Actor analytics and dashboard preferences locally on the user's device so previously loaded months remain available between Apify Console visits. The extension does not use sync storage and does not send stored data to the developer or any third party.
```

### Site access justification

```text
Access to https://console.apify.com/* is required to place the analytics interface inside Apify Console, observe the analytics responses requested by the signed-in page, and request additional Actor-level analytics from Apify's own Console backend. The extension does not run on other websites.
```

### Remote code

Select:

```text
No, I am not using remote code.
```

All executable JavaScript and CSS is included in the extension package. Responses
from Apify contain data only and are not executed as code.

### User-data disclosures

Disclose the following categories because Chrome requires disclosure even when
data is processed or stored only on the user's device:

- **Financial and payment information** — Actor revenue, cost, profit, and margin.
- **Authentication information** — the active Apify request context is held in
  page memory only so requests can be made to Apify's own backend. It is never
  written to extension storage or sent to the developer.
- **Website content** — Actor analytics responses displayed by Apify Console.

Do not select personally identifiable information, health information, personal
communications, location, or web history unless the implementation later changes
to handle those categories.

Certify that:

- Data is used only to provide the extension's disclosed analytics functionality.
- Data is not sold or transferred for advertising, profiling, or unrelated uses.
- Data is not used for creditworthiness or lending decisions.
- Handling complies with the Chrome Web Store Limited Use requirements.

## 4. Graphic assets

Prepare these separately from the extension ZIP:

- Store icon: 128 × 128 px PNG.
- At least one screenshot: 1280 × 800 px PNG or JPEG; up to five screenshots.
- Small promotional tile: 440 × 280 px PNG or JPEG if requested by the dashboard.
- Marquee promotional tile: 1400 × 560 px, optional.
- YouTube demo URL: add one if requested or if you want a product walkthrough.

This repository includes `store-assets.html` with five capture-ready, opaque
layouts at the required dimensions. Open the file in Chrome with one of these
query parameters:

```text
store-assets.html?asset=screenshot-overview  1280 × 800
store-assets.html?asset=screenshot-daily     1280 × 800
store-assets.html?asset=screenshot-health    1280 × 800
store-assets.html?asset=small-promo          440 × 280
store-assets.html?asset=marquee-promo        1400 × 560
```

Set the browser viewport to the matching dimensions and capture only the page
canvas. Save as JPEG or opaque 24-bit PNG. `store-assets.html` is a marketing
source file and should not be included in the extension upload ZIP.

Recommended screenshots:

1. Fullscreen Overview with revenue, profit, health, and Actor trends.
2. Daily earnings stacked chart with the full-day tooltip open.
3. Run activity showing failed or timed-out runs by Actor.
4. Actor quality list with one Actor expanded.
5. Traffic and acquisition dashboard.

Use demo or carefully reviewed data. Do not expose private revenue, identifiers,
access tokens, request headers, or unrelated account information in screenshots.

## 5. Test instructions for the reviewer

```text
1. Sign in to an Apify account that owns at least one Actor with analytics data.
2. Open https://console.apify.com/actors/insights/monetization.
3. Reload the page once after installing the extension.
4. Click Analytics in the Monetization chart header. If that control has not mounted yet, use the Analytics launcher in the lower-right corner.
5. Switch among Overview, Daily earnings, Run activity, User activity, Actor performance, Actor quality, and Traffic & acquisition.
6. Use the month/year controls and Actor selector to verify filtering.

No separate extension account, API key, or payment is required. The extension uses the reviewer's existing signed-in Apify Console session and only displays data available to that account.
```

If the reviewer cannot create a suitable Apify account, provide a dedicated test
account through the Chrome Web Store's secure reviewer credentials fields. Never
put credentials in this repository or in the public listing.

## 6. Create and upload a release ZIP

Run the repository's release checks and packaging script:

```bash
node scripts/check-release.mjs
./scripts/package-extension.sh
```

The generated ZIP is written to `dist/` with `manifest.json` at its root and only
the runtime files included:

```text
manifest.json
content.js
interceptor.js
styles.css
logo.svg
icons/
```

For a Store update:

1. Increase `version` in `manifest.json`.
2. Test the unpacked extension and run the checks above.
3. Open the existing item in the Chrome Web Store Developer Dashboard and upload
   the generated ZIP under **Package**.
4. Review **Store listing**, **Privacy practices**, **Distribution**, and
   **Test instructions**.
5. Preview the listing, fix all dashboard warnings, and submit the update for
   review.

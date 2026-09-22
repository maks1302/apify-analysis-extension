# Apify Earnings Dashboard — MVP

A local-only Chrome extension that visualizes the profit-margin data already loaded by Apify Console. It does not read cookies, store authorization headers, or send analytics to another server.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory.
5. Open Apify Console and visit the Monetization dashboard.
6. Reload the Apify page once after installing the extension.
7. Click the **Analytics** button in the Monetization chart header (or the fallback button in the lower-right corner).

Use the **Overview** and **Actors** tabs to switch between daily trends and the
per-Actor ranking. Actor rows include revenue, cost, profit, paying users, run
success rate, result volume, and pricing model.

The Actors tab also includes a month-to-date revenue composition chart and a run
health dashboard. Revenue bars are split into net profit and cost; the health
dashboard ranks Actors by failed, aborted, and timed-out runs.

When Apify's `profit-margin` endpoint accepts an `actorIds` filter, the extension
also builds a **Daily mix** stacked chart. Authentication stays in page memory,
requests run with a concurrency limit of four, and the loader stops if filtering
is unavailable. The chart can switch between daily revenue and daily profit.
Daily cost is also available from the same chart. Run-health totals can be filtered
by failed, aborted, and timed-out runs; these values are monthly because the current
actor-breakdown response does not include a daily run-status dimension.

The **Daily runs** tab fills that dimension from
`/actor-analytics/run-statistics/monthly/all-users`. It provides stacked daily
Actor charts for aborted, failed, succeeded, timed-out, total runs, and results.

Hovering any daily bar opens a consolidated tooltip with every contributing Actor
ranked by value, including its color, exact value, and percentage of that day's
total. This applies to both financial and run-statistic charts.

Use the month and year selectors to request another period with the current
in-memory Apify session. The Actor multi-select defaults to all Actors and filters
the overview, financial stacks, run stacks, rankings, and health tables locally.

On the Apify Monetization page, **Advanced analytics** is mounted into the chart
card header using stable `data-test` selectors. A MutationObserver restores it
after SPA rerenders; the floating launcher remains available as a fallback.

The **Daily users** tab loads `/actor-analytics/user-count-statistics` for each
Actor and visualizes paying, free, and total Actor-user occurrences by day. These
totals are not claimed as globally unique users because one person can use more
than one Actor.

The **Quality** tab lazily loads Actor quality scores, praises and improvements,
basic information, and operational metrics when opened. Its collapsed list shows
quality, success rate, users, rating, reviews, and bookmarks. Expanding an Actor
shows schema and README checks, user-growth windows, run history, categories,
praises, and recommended improvements. Quality data is cached separately from
monthly analytics because it belongs to the Actor rather than a reporting month.

The **Acquisition** tab loads `/actor-analytics/monthly-marketing` for each Actor
in the selected month. It summarizes Store and Console page views, viewing users,
users with a run, weighted referrer mix, and audience geography. The expandable
Actor list exposes each Actor's own sources and countries. Portfolio totals are
explicitly labeled as Actor-level unique counts because the same person may be
counted under more than one Actor.

## How the MVP works

- A main-world script observes only requests to the profit-margin and actor-breakdown
  endpoints under `https://console-backend.apify.com/actor-analytics/`.
- The original response is cloned and is never modified.
- A content script keeps only normalized daily values and the actor statistics used by
  the dashboard.
- Captured months are saved in `chrome.storage.local` so they remain available between visits.

The endpoint is internal to Apify and may change. If the dashboard stays in the waiting state, inspect the Apify Network panel to check whether its URL or response schema changed.

## Security

The extension deliberately has only the `storage` permission and access to `https://console.apify.com/*`. It has no `cookies`, `webRequest`, or broad host permissions. Do not add an Apify token to these source files.

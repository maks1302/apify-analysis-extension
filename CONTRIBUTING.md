# Contributing

Thanks for helping improve Actor Analytics for Apify.

## Before opening an issue

- Search the existing issues first.
- Confirm the problem still occurs with the latest Chrome Web Store release or
  the current `main` branch.
- Never attach Apify tokens, request headers, cookies, private revenue exports,
  or screenshots containing sensitive account information.

Use the bug-report template for reproducible defects and the feature-request
template for focused product proposals. Report security issues privately using
the instructions in [SECURITY.md](SECURITY.md).

## Local development

There are no runtime dependencies or build step.

1. Fork and clone the repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the repository directory.
4. After every source change, click **Reload** on the extension card and reload
   the Apify Console page.
5. Run `node scripts/check-release.mjs` before committing.

## Manual test checklist

- The extension loads without errors in `chrome://extensions`.
- The inline Analytics button mounts on the Monetization chart.
- The fallback launcher clears Apify's support button.
- The panel opens, closes, enters fullscreen, and exits fullscreen.
- Every dashboard tab can be selected repeatedly.
- Month/year selection and Actor filtering work.
- Actor and Help popovers close on outside click and Escape.
- Daily tooltips show a complete, sorted Actor breakdown.
- Run inspector status tabs filter independently from the monthly chart, refresh
  correctly, and open the expected Apify run in a new tab.
- The run inspector makes one shared-runs request per selected Actor and reuses
  that Actor's latest-run sample across every status tab.
- Recent runs are not written to `chrome.storage.local`, and run user IDs or
  internal worker/network identifiers do not cross into the dashboard payload.
- Current-month charts stop at the current day.
- Light and dark themes remain readable.
- No request is made to a non-Apify analytics host.
- No authentication header or token is written to extension storage.

## Pull requests

Keep changes focused and explain the user-facing behavior. Include before/after
screenshots for interface changes, using demo or redacted data. Update the README,
privacy policy, or Store disclosures whenever a change affects permissions,
network activity, stored data, or user-data handling.

Do not add:

- Remote executable code or runtime-loaded JavaScript.
- Telemetry, advertising, or third-party analytics.
- Broad host, cookie, or `webRequest` permissions without prior discussion.
- Production credentials, copied Apify responses, or private account data.

By contributing, you agree that your contribution is licensed under the MIT
License used by this repository.

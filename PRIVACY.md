# Privacy Policy for Actor Analytics for Apify

**Effective date:** September 23, 2026

Actor Analytics for Apify is an independent browser extension that adds analytics
views to Apify Console. It is not affiliated with, endorsed by, or sponsored by
Apify.

## Data the extension handles

The extension processes data available to the user's signed-in Apify Console
account, including:

- Actor revenue, costs, profit, margin, pricing, and other monetization metrics.
- Actor runs, results, user counts, quality signals, and acquisition statistics.
- Actor names, identifiers, images, and related metadata shown by Apify Console.
- The active Apify request context needed to request the same analytics from
  Apify's Console backend.

This data is handled solely to provide the extension's analytics dashboards.

## Local storage and retention

Normalized Actor analytics and dashboard state are stored locally using
`chrome.storage.local` so previously loaded information remains available between
visits. This local data remains on the user's device until the user clears the
extension's storage or removes the extension.

Authentication headers or tokens are not written to extension storage. The active
Apify request context is held only in page memory while the Apify Console page is
open and is discarded when that page is closed or reloaded.

## Network activity and sharing

Analytics requests are sent only over HTTPS to Apify's Console backend at
`console-backend.apify.com`. Actor images may be loaded from Apify's image-storage
host. The extension does not send analytics, authentication information, or usage
data to the extension developer or to advertising, telemetry, or third-party
analytics services.

The Help & Contact link opens GitHub only after the user explicitly clicks it.
GitHub's own privacy terms apply after that external page is opened.

## Telemetry and advertising

The extension contains no telemetry, behavioral tracking, advertising, or
third-party analytics SDKs. User data is not sold, used for advertising, used to
build user profiles, or used for creditworthiness or lending decisions.

## Security

The extension runs only on `https://console.apify.com/*`, requests only the
minimum Chrome permission required for local storage, and communicates with the
Apify analytics backend over HTTPS. It does not request Chrome cookie access,
web-request access, or broad access to unrelated websites.

## Chrome Web Store Limited Use

The extension's use of information received from Chrome APIs complies with the
Chrome Web Store User Data Policy, including the Limited Use requirements. Data
is used only to provide or improve the extension's clearly disclosed,
user-facing Actor analytics functionality.

## User choices and deletion

Users can stop all extension processing by disabling or uninstalling the
extension. Uninstalling removes its local extension storage. Users can also clear
the extension's stored data through Chrome's extension/site-data controls.

## Changes to this policy

If the extension's data practices change, this policy and the Chrome Web Store
privacy disclosures will be updated before the changed behavior is released.

## Contact

Questions and support requests can be submitted at:

https://github.com/maks1302/apify-analysis-extension/issues


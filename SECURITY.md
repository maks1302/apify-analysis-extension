# Security Policy

## Supported version

Security fixes are applied to the latest version published in the Chrome Web
Store and the current `main` branch.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability involving authentication,
data exposure, request interception, origin validation, or extension permissions.

Use GitHub's private vulnerability-reporting flow:

https://github.com/maks1302/apify-analysis-extension/security/advisories/new

Include the affected version, reproduction steps, impact, and any suggested fix.
Do not include real Apify credentials, tokens, cookies, or private analytics data.

If private vulnerability reporting is not available, contact MintAPI through
https://mintapi.dev and ask for a private security channel before sharing details.

## Security boundaries

The extension is designed to:

- Run only on `https://console.apify.com/*`.
- Send extension-initiated analytics requests only to
  `https://console-backend.apify.com`.
- Keep authentication context in page memory and out of extension storage.
- Store normalized dashboard data only in `chrome.storage.local`.
- Avoid telemetry, remote code, advertising, cookie permissions, `webRequest`,
  and broad host access.

Changes that weaken these boundaries require explicit review and corresponding
updates to the privacy policy and Chrome Web Store disclosures.


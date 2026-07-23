# kuruma-dorekana

Toddler-friendly web game MVP. Open the page, press Start, then choose the car that matches the sample car.

This repository is dedicated to the car game only. It is separate from the ALIENA website and body-balance-log.

Files:
- index.html: self-contained playable MVP
- README.md: this note

GitHub Pages target:
https://aliena-action.github.io/kuruma-dorekana/

## Feedback storage and reports

- The parent feedback form posts to `POST /api/feedback`.
- Cloudflare Pages binds the production D1 database as `DB`.
- Weekly and on-demand reports share `functions/lib/feedback-report.js`.
- Operations and setup: [docs/feedback-reporting.md](docs/feedback-reporting.md)

Required configuration:

| Location | Name | Type | Minimum permission |
| --- | --- | --- | --- |
| Cloudflare Pages | `REPORT_ADMIN_TOKEN` | Secret | Authenticate only `/api/admin/feedback-report` |
| Cloudflare Pages | `RESEND_API_KEY` | Secret | Send email only from the verified report domain |
| Cloudflare Pages | `REPORT_FROM_EMAIL` | Variable | Verified sender address |
| Cloudflare Pages | `REPORT_TO_EMAIL` | Variable | Report recipient (`tokiabe@icloud.com`) |
| GitHub Actions | `REPORT_ADMIN_TOKEN` | Secret | Trigger only the protected report endpoint |
| GitHub Actions | `FEEDBACK_REPORT_ENDPOINT` | Repository variable | HTTPS endpoint URL without credentials |

Do not put secret values, feedback exports, or report bodies in commits, workflow artifacts, logs, client-side HTML, or URL query strings.

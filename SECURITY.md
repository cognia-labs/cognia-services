# Security policy

These services hold share links, account sync data, identity sessions and
diagnostic reports, so we treat reports about them as a priority.

## Supported versions

The `main` branch, the latest version tag of the images, and the Workers as
currently deployed receive security fixes. Older image tags do not.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Use one of:

1. **GitHub private vulnerability reporting** (preferred):
   <https://github.com/cognia-labs/cognia-services/security/advisories/new>
2. **Email** `astro_air@126.com` with the subject prefix `[security][cognia-services]`.

Please include the affected service, the commit or image tag, steps to
reproduce, and the impact you see. A vulnerability in the desktop or mobile app
itself belongs to [cognia-next](https://github.com/MaxQian888/cognia-next/security/advisories/new).

We aim to acknowledge a report within 7 days and to fix or disclose it within 90
days; critical issues are handled faster. We will credit you in the advisory
unless you ask us not to.

## Scope notes

- The share and sync services are designed so the server never sees plaintext
  content (ADR-0037, ADR-0215 under [`docs/adr/`](docs/adr/README.md)). A way
  to read content, names or keys from the server side is in scope.
- Test vectors and development keys committed under `fixtures/`, `test/` and
  `deploy/seed/` are public by design and are not secrets.

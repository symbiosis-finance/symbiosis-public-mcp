# Escalation Report — Vulnerabilities Without Clean Fix Paths

**Date:** 2026-05-21

The following packages cannot be patched by bumping a manifest entry alone.
Overrides would mechanically resolve them but were NOT applied automatically.
Review each item and decide whether to apply the suggested override.

---

## Item 1 — @hono/node-server (HIGH)

| Field | Value |
|-------|-------|
| Package | `@hono/node-server@1.19.9` |
| Severity | HIGH |
| Advisory IDs | GHSA-wc8c-qw6v-h7f6, GHSA-92pp-h63x-v22m |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.@hono/node-server = "1.19.13"` |

- **GHSA-wc8c-qw6v-h7f6**: @hono/node-server has authorization bypass for protected static paths via encoded slashes in Serve S
- **GHSA-92pp-h63x-v22m**: @hono/node-server: Middleware bypass via repeated slashes in serveStatic

## Item 2 — express-rate-limit (HIGH)

| Field | Value |
|-------|-------|
| Package | `express-rate-limit@8.2.1` |
| Severity | HIGH |
| Advisory IDs | GHSA-46wh-pxpv-q5gq |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.express-rate-limit = "8.2.2"` |

- **GHSA-46wh-pxpv-q5gq**: express-rate-limit: IPv4-mapped IPv6 addresses bypass per-client rate limiting on servers with dual-

## Item 3 — hono (HIGH)

| Field | Value |
|-------|-------|
| Package | `hono@4.11.10` |
| Severity | HIGH |
| Advisory IDs | GHSA-p6xx-57qc-3wxr, GHSA-5pq2-9x2x-5p6w, GHSA-9vqf-7f2p-gf9v, GHSA-wmmm-f939-6g9c, GHSA-qp7p-654g-cw7p |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.hono = "4.12.18"` |

- **GHSA-p6xx-57qc-3wxr**: Hono Vulnerable to SSE Control Field Injection via CR/LF in writeSSE()
- **GHSA-5pq2-9x2x-5p6w**: Hono Vulnerable to Cookie Attribute Injection via Unsanitized domain and path in setCookie()
- **GHSA-9vqf-7f2p-gf9v**: Hono: bodyLimit() can be bypassed for chunked / unknown-length requests

## Item 4 — ip-address (MODERATE)

| Field | Value |
|-------|-------|
| Package | `ip-address@10.0.1` |
| Severity | MODERATE |
| Advisory IDs | GHSA-v2v4-37r5-5v8g |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.ip-address = "10.1.1"` |

- **GHSA-v2v4-37r5-5v8g**: ip-address has XSS in Address6 HTML-emitting methods

## Item 5 — path-to-regexp (HIGH)

| Field | Value |
|-------|-------|
| Package | `path-to-regexp@8.3.0` |
| Severity | HIGH |
| Advisory IDs | GHSA-27v5-c462-wpq7, GHSA-j3q9-mxjg-w52f |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.path-to-regexp = "8.4.0"` |

- **GHSA-27v5-c462-wpq7**: path-to-regexp vulnerable to Regular Expression Denial of Service via multiple wildcards
- **GHSA-j3q9-mxjg-w52f**: path-to-regexp vulnerable to Denial of Service via sequential optional groups

## Item 6 — ws (MODERATE)

| Field | Value |
|-------|-------|
| Package | `ws@8.17.1` |
| Severity | MODERATE |
| Advisory IDs | GHSA-58qx-3vcg-4xpx |
| Dep path | unknown |
| Why no clean fix | Could not trace to a direct manifest ancestor |
| Override recipe | `overrides.ws = "8.20.1"` |

- **GHSA-58qx-3vcg-4xpx**: ws: Uninitialized memory disclosure

---

## Decision Required

For the items above, the only mechanical fix is an override.
Reply with package names or advisory IDs to override, or 'none' to leave them unresolved.

# RQ-Sys local web workbench

Local-only React + Vite workbench for the RQ-Sys MVP. The UI calls the same-origin `/api/*` routes; Vite proxies them to `http://127.0.0.1:8787` by default. Override the proxy target locally with `API_PROXY_TARGET` if needed. The browser never receives integration credentials.

## Start locally

In two terminals, from the repository root:

```sh
npm run dev:api
npm run dev:web
```

Open <http://127.0.0.1:5173>. The API and browser app remain local; no deploy workflow is configured.

## Current UI scope

The Overview reads API health, source config, batches and requirement pipeline state; it submits manual sync requests using the API's idempotency header. Requirements and Batches are data-backed. Source settings show read-only state until the API supports source creation/configuration UI. Owner mapping, Rules and Audit show explicit API-not-ready states instead of mock records. The current API skeleton only serves health/readiness and the implemented batch/source endpoints; unavailable contract routes are surfaced as errors and do not create fake counts or status.

## Verify

```sh
npm --workspace @rq-sys/web test
npm --workspace @rq-sys/web run typecheck
npm --workspace @rq-sys/web run build
```

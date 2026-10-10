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

The workbench is wired to the API for source configuration, manual sync, batch detail and item retry, requirement search/detail, AI-analysis retry, owner mapping, rules, and audit. Owner mapping searches Feishu through the server-side `/api/feishu/users` adapter and requires an operator to select a returned candidate before saving. Only the candidate's Open ID, display name, and optional English name are returned to the browser; the app secret and access token remain server-side.

The local server identity provider is intentionally a placeholder until the Miaoda session/token contract is verified. Protected routes therefore cannot be treated as a ready-to-use local or production login flow. Feishu user search also requires the app's contact-search permission and server-side `FEISHU_APP_ID` / `FEISHU_APP_SECRET`. Target Miaoda persistence, identity, scheduler/background execution, Feishu permissions, and end-to-end integrations remain acceptance gates; local API responses and tests are not target-environment evidence.

## Verify

```sh
npm --workspace @rq-sys/web test
npm --workspace @rq-sys/web run typecheck
npm --workspace @rq-sys/web run build
```

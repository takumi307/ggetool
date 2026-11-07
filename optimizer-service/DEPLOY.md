# Deployment checklist (Render example)

This repository contains the Python OR-Tools solver, but a GitHub merge does not deploy it.

1. Open [Render Dashboard](https://dashboard.render.com/) and choose **New > Web Service**, connecting `takumi307/ggetool`.
2. Select **Docker**, set **Root Directory** to `optimizer-service`, and use `Dockerfile`. Alternatively, create the service from `optimizer-service/render.yaml` if Render accepts its blueprint location.
3. Select a plan with sufficient CPU and memory for your inventory size. CP-SAT can consume substantial resources; start with limited users and monitor resource usage.
4. Set `CORS_ORIGINS` to the exact frontend origin (for example `https://ggetool.takutaku307.workers.dev`, without a trailing slash). CORS is **not** authorization.
5. After the service deploys, visit `https://YOUR-RENDER-SERVICE.onrender.com/health` and confirm `ok: true` and `castellan: true`.
6. **Before exposing to untrusted users**, put the service behind an authenticated proxy/API gateway with rate limits, request size limits, and concurrency limits. The current browser client has no authentication integration, so do not claim this step is complete. Do not put a private API token into a `VITE_` environment variable; it becomes public in the browser.
7. In the Cloudflare frontend build settings, add `VITE_OPTIMIZER_API_URL=https://YOUR-RENDER-SERVICE.onrender.com` (no trailing slash), rebuild/deploy the frontend, then test a small plan.
8. Confirm `OPTIMAL` vs `FEASIBLE` statuses and inspect the preview before saving. Existing IndexedDB records are not migrated.

## Preflight

- GitHub Actions workflow `CP-SAT service checks` must pass before production use.
- The backend is stateless; inventory is transmitted to the optimizer. Do not include credentials or private notes beyond the required inventory fields.
- The server time limit applies per phase. Commander requests run up to two phases and castellan requests run up to three (build count, plan priority, then total weighted defense score). The frontend uses the asynchronous job API for both. Deploy the updated optimizer before using castellan cloud or local execution.
- Stop/cancel in the browser aborts the HTTP request, but may not stop CPU computation already running server-side.
- No deployment credentials or server connection are configured by this PR.

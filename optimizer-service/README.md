# E4K CP-SAT optimization service

Python 3.12 / FastAPI / Google OR-Tools CP-SAT. No database; input is supplied by the browser, and results are returned without storing data.

## Local

```bash
cd optimizer-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
CORS_ORIGINS=http://localhost:5173 uvicorn app:app --port 8080
```

Set `VITE_OPTIMIZER_API_URL=http://localhost:8080` in frontend `.env.local` and restart Vite. For production, deploy this Dockerfile to a Python-compatible host, enable HTTPS, and set `CORS_ORIGINS=https://<your-frontend-domain>` on the service and `VITE_OPTIMIZER_API_URL=https://<your-service-domain>` on Cloudflare build environment. **Do not put secrets in VITE_ variables.**

The service is unauthenticated in this PR: protect the public endpoint with API gateway authentication, quotas/rate limiting, request-size and concurrency limits before production use. CORS is not authentication. This PR does not provision or deploy a server.

## Optimization semantics

- One unique equipment per slot per successful commander; equipment and gems cannot be shared.
- At most one compatible gem per slot; no gem required.
- Known stat caps are respected for minimum thresholds; unknown/disabled caps are unbounded.
- Decimal values are represented exactly to 3 decimal places (integer scale 1000).
- First maximize the number of builds meeting *all* targets. Preserve the best count found and continue with quality stages even if the count is not yet proven optimal. Later stages never lower the previous solution’s value for the objective being improved.
- Default commander stages are count, then plan priority and retention. Default castellan stages are count, priority, then weighted defense. Custom presets can order priority, weighted effects, target overshoot, and retention after count.
- `countOptimal` reports the proof for build count. `optimal` / `OPTIMAL` requires all configured active stages to prove optimal. A time-limited result can still be valid without that proof. Each stage’s status, value and bound are included in `stages`.
- The time limit is per stage: up to two default commander stages, three default castellan stages, or five custom stages. Locked/reserved equipment and gems are excluded; selected existing builds can be reassigned during reoptimization, with their current assignments used as warm hints.
- A build may remain unassigned when its targets cannot be achieved. No changes to user data occur until the frontend saves results.

## API

- POST `/jobs` starts an asynchronous calculation and immediately returns a job ID. Supply a stable `requestId` to safely retry the same submission.
- GET `/jobs/{jobId}` returns the state, stage progress, and completed result. The frontend uses these endpoints to avoid long proxy connections.
- POST `/optimize` accepts the same payload for synchronous local tests.
- GET `/health` reports availability.

Payload fields include `equipment`, `gems`, `stats`, `jobs`, `reservedEquipmentIds`, `reservedGemIds`, `timeLimitSeconds`, and optional `objectiveOrder`. Jobs can include `scoring`, `overshoot`, retention preferences, and previous assignments. Job results are held temporarily in memory; a server restart loses them.

All incoming IDs are untrusted; production hosting needs access controls and resource quotas. Large instances may be computationally expensive.

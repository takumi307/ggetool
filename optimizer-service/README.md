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
- First maximize number of commanders meeting *all* targets. When proven optimal, fix that count and maximize plan priority score. `OPTIMAL` is reported only when both passes prove optimal. `FEASIBLE` means a valid but unproven assignment.
- Solver time limit is per pass (up to twice selected duration). Existing allocated equipment/gems are excluded.
- A build may remain unassigned when its targets cannot be achieved. No changes to user data occur until the frontend saves results.

## API

POST `/optimize` JSON: `equipment`, `gems`, `stats`, `jobs`, `reservedEquipmentIds`, `reservedGemIds`, `timeLimitSeconds`.
GET `/health`.

All incoming IDs are untrusted; production hosting needs access controls and resource quotas. Large instances may be computationally expensive.

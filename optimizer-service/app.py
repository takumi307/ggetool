"""Exact multi-commander assignment model using OR-Tools CP-SAT.

Run with: uvicorn app:app --host 0.0.0.0 --port 8080
No user data is persisted. Deploy behind authentication and rate limits.
"""
import math
import os
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from ortools.sat.python import cp_model

SLOTS = ("helmet", "weapon", "armor", "artifact")
SCALE = 1000
def scaled(value: float) -> int:
    if not math.isfinite(value) or abs(value) > 100000:
        raise ValueError("Invalid numeric value")
    d = Decimal(str(value)) * SCALE
    if d != d.to_integral_value():
        raise ValueError("Values must have at most three decimal places")
    return int(d)

class Effect(BaseModel):
    statId: str
    value: float = Field(ge=0, le=100000)
class Equipment(BaseModel):
    id: str
    slotType: Literal["helmet", "weapon", "armor", "artifact"]
    effects: list[Effect]
class Gem(BaseModel):
    id: str
    allowedSlots: list[Literal["helmet", "weapon", "armor", "artifact"]]
    effects: list[Effect]
class Stat(BaseModel):
    id: str
    capStatus: str
    cap: float | None = None
class Target(BaseModel):
    statId: str
    minValue: float = Field(ge=0, le=100000)
class Job(BaseModel):
    presetId: str
    ordinal: int = Field(ge=1)
    priority: int = Field(ge=1)
    targets: list[Target]
class Request(BaseModel):
    equipment: list[Equipment] = Field(max_length=1500)
    gems: list[Gem] = Field(max_length=1500)
    stats: list[Stat] = Field(max_length=300)
    jobs: list[Job] = Field(max_length=100)
    reservedEquipmentIds: list[str] = Field(default_factory=list)
    reservedGemIds: list[str] = Field(default_factory=list)
    timeLimitSeconds: int = Field(default=60, ge=5, le=300)
    @model_validator(mode="after")
    def check_ids(self):
        if len({e.id for e in self.equipment}) != len(self.equipment):
            raise ValueError("Duplicate equipment IDs")
        if len({g.id for g in self.gems}) != len(self.gems):
            raise ValueError("Duplicate gem IDs")
        if len({s.id for s in self.stats}) != len(self.stats):
            raise ValueError("Duplicate stat IDs")
        return self

app = FastAPI(title="E4K CP-SAT Optimizer", version="1.0")
origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/optimize")
def optimize(data: Request):
    if not data.jobs:
        return {"status": "OPTIMAL", "optimal": True, "achieved": 0, "upperBound": 0, "requested": 0, "builds": []}
    reserved_e = set(data.reservedEquipmentIds)
    reserved_g = set(data.reservedGemIds)
    eq = [e for e in data.equipment if e.id not in reserved_e]
    gems = [g for g in data.gems if g.id not in reserved_g]
    caps = {s.id: scaled(s.cap) for s in data.stats if s.capStatus == "known" and s.cap is not None}
    # Pre-index candidates and their relevant effects once. This avoids
    # repeatedly scanning every candidate for each job/slot/target.
    equipment_by_slot = {slot: [] for slot in SLOTS}
    for e in eq:
        equipment_by_slot[e.slotType].append(e)
    gems_by_slot = {slot: [] for slot in SLOTS}
    for g in gems:
        for slot in g.allowedSlots:
            gems_by_slot[slot].append(g)
    relevant_stats = {t.statId for job in data.jobs for t in job.targets}
    def effect_totals(item):
        result = {}
        for effect in item.effects:
            if effect.statId in relevant_stats:
                result[effect.statId] = result.get(effect.statId, 0) + scaled(effect.value)
        return result
    equipment_effects = {e.id: effect_totals(e) for e in eq}
    gem_effects = {g.id: effect_totals(g) for g in gems}
    model = cp_model.CpModel()
    n = len(data.jobs)
    active = [model.NewBoolVar(f"active_{j}") for j in range(n)]
    x = {}
    y = {}
    equipment_uses = {e.id: [] for e in eq}
    gem_uses = {g.id: [] for g in gems}
    equipment_stat_terms = {(j, stat): [] for j in range(n) for stat in relevant_stats}
    gem_stat_terms = {(j, stat): [] for j in range(n) for stat in relevant_stats}
    for j in range(n):
        for slot in SLOTS:
            slot_equipment = []
            for e in equipment_by_slot[slot]:
                var = model.NewBoolVar(f"e_{j}_{slot}_{e.id}")
                x[j, slot, e.id] = var
                slot_equipment.append(var)
                equipment_uses[e.id].append(var)
                for stat, value in equipment_effects[e.id].items():
                    equipment_stat_terms[j, stat].append(value * var)
            model.Add(sum(slot_equipment) == active[j])
            slot_gems = []
            for g in gems_by_slot[slot]:
                var = model.NewBoolVar(f"g_{j}_{slot}_{g.id}")
                y[j, slot, g.id] = var
                slot_gems.append(var)
                gem_uses[g.id].append(var)
                for stat, value in gem_effects[g.id].items():
                    gem_stat_terms[j, stat].append(value * var)
            model.Add(sum(slot_gems) <= active[j])
    for uses in equipment_uses.values():
        model.Add(sum(uses) <= 1)
    for uses in gem_uses.values():
        model.Add(sum(uses) <= 1)
    # Identical jobs are interchangeable. Enforce an active-prefix order
    # within each identical target/priority group, preserving optimal count
    # and priority objective without restricting distinct jobs.
    previous_identical = {}
    for j, job in enumerate(data.jobs):
        signature = (job.presetId, job.priority,
                     tuple(sorted((t.statId, scaled(t.minValue)) for t in job.targets)))
        if signature in previous_identical:
            model.Add(active[j] <= active[previous_identical[signature]])
        previous_identical[signature] = j
    # Each minimum target is a linear sum of equipment and gem contributions.
    for j, job in enumerate(data.jobs):
        for target in job.targets:
            minimum = scaled(target.minValue)
            if target.statId in caps and caps[target.statId] < minimum:
                model.Add(active[j] == 0)
                continue
            terms = equipment_stat_terms[j, target.statId] + gem_stat_terms[j, target.statId]
            model.Add(sum(terms) >= minimum * active[j])
    # Lexicographic objective: number of successful builds first, priority second.
    count = sum(active)
    model.Maximize(count)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = data.timeLimitSeconds
    solver.parameters.num_search_workers = 2
    status = solver.Solve(model)
    # Integer objective: CP-SAT best bound is a certified upper bound on the
    # maximum achievable count (not an estimate of the next feasible solution).
    bound = min(n, max(0, math.floor(solver.BestObjectiveBound() + 1e-6)))
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {"status": solver.StatusName(status), "optimal": False, "achieved": 0, "upperBound": bound if status != cp_model.MODEL_INVALID else None, "requested": n, "builds": []}
    first_count = round(solver.Value(count))
    bound = max(first_count, bound)
    best_solver = solver
    final_status = status
    # Only perform priority tie-break if the maximum count is proven.
    if status == cp_model.OPTIMAL:
        model.Add(count == first_count)
        max_priority = max(job.priority for job in data.jobs)
        weights = [max_priority + 1 - job.priority for job in data.jobs]
        model.Maximize(sum(weights[j] * active[j] for j in range(n)))
        second = cp_model.CpSolver()
        second.parameters.max_time_in_seconds = data.timeLimitSeconds
        second.parameters.num_search_workers = 2
        second_status = second.Solve(model)
        if second_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            best_solver = second
            final_status = second_status
    builds = []
    for j, job in enumerate(data.jobs):
        if not best_solver.Value(active[j]):
            continue
        chosen = {slot: next(e.id for e in eq if e.slotType == slot and best_solver.Value(x[j, slot, e.id])) for slot in SLOTS}
        assignments = [{"slotType": slot, "gemId": g.id} for slot in SLOTS for g in gems
                       if (j, slot, g.id) in y and best_solver.Value(y[j, slot, g.id])]
        totals = {}
        for e in eq:
            if e.id in chosen.values():
                for effect in e.effects:
                    totals[effect.statId] = totals.get(effect.statId, 0) + scaled(effect.value)
        gem_ids = {a["gemId"] for a in assignments}
        for g in gems:
            if g.id in gem_ids:
                for effect in g.effects:
                    totals[effect.statId] = totals.get(effect.statId, 0) + scaled(effect.value)
        builds.append({
            "presetId": job.presetId, "ordinal": job.ordinal, "equipmentIds": chosen,
            "gemAssignments": assignments,
            "totals": {key: val / SCALE for key, val in totals.items()},
            "shortfalls": [{"statId": t.statId, "required": t.minValue,
                            "actual": min(totals.get(t.statId, 0), caps.get(t.statId, 10**18)) / SCALE,
                            "missing": 0} for t in job.targets],
            "overflow": [{"statId": key, "cap": cap / SCALE, "raw": totals[key] / SCALE}
                         for key, cap in caps.items() if totals.get(key, 0) > cap]
        })
    return {"status": best_solver.StatusName(final_status),
            "upperBound": bound,
            "optimal": status == cp_model.OPTIMAL and final_status == cp_model.OPTIMAL,
            "achieved": len(builds), "requested": n, "builds": builds}

# Asynchronous jobs avoid holding a browser/proxy HTTP connection open during
# long CP-SAT searches. Free Render has ephemeral process memory: restarting
# the service loses running jobs; callers receive 404 and may retry.
_JOB_TTL = 60 * 60
_job_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_executor = ThreadPoolExecutor(max_workers=1)
_MAX_JOBS = 12

def _expire_jobs():
    now = time.monotonic()
    for key, job in list(_jobs.items()):
        if job["state"] != "running" and now - job["updated"] > _JOB_TTL:
            del _jobs[key]

def _run_job(job_id: str, data: Request):
    try:
        result = optimize(data)
        with _job_lock:
            _jobs[job_id].update(state="completed", result=result, updated=time.monotonic())
    except Exception as exc:
        with _job_lock:
            _jobs[job_id].update(state="failed", error=str(exc), updated=time.monotonic())

@app.post("/jobs", status_code=202)
def start_job(data: Request):
    with _job_lock:
        _expire_jobs()
        # Free-tier instance: prevent unbounded CPU and memory queues.
        if any(job["state"] == "running" for job in _jobs.values()):
            raise HTTPException(status_code=429, detail="別の最適化を実行中です。完了後に再試行してください。")
        if len(_jobs) >= _MAX_JOBS:
            oldest = min(_jobs, key=lambda key: _jobs[key]["updated"])
            del _jobs[oldest]
        job_id = uuid.uuid4().hex
        _jobs[job_id] = {"state": "running", "updated": time.monotonic()}
    _executor.submit(_run_job, job_id, data)
    return {"jobId": job_id, "state": "running"}

@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    with _job_lock:
        _expire_jobs()
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="計算ジョブが見つかりません。サーバー再起動の可能性があります。")
        response = {"jobId": job_id, "state": job["state"]}
        if "result" in job:
            response["result"] = job["result"]
        if "error" in job:
            response["error"] = job["error"]
        return response

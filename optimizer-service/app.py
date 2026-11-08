"""Exact multi-commander assignment model using OR-Tools CP-SAT.

Run with: uvicorn app:app --host 0.0.0.0 --port 8080
No user data is persisted. Deploy behind authentication and rate limits.
"""
from hashlib import sha256
import math
import os
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
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
    cap: float | None = Field(default=None, ge=0, le=100000)
class Target(BaseModel):
    statId: str
    npcBonusStatId: str | None = None
    minValue: float = Field(ge=0, le=100000)
class ScoringStat(BaseModel):
    id: str
    scale: float = Field(gt=0, le=100000000)
    weight: int = Field(ge=1, le=100)

ObjectiveStage = Literal["planPriority", "weighted", "overshoot", "stability"]

class Job(BaseModel):
    requiredEquipmentIds: list[str] = Field(default_factory=list)
    requireEquipment: bool = False
    presetId: str
    ordinal: int = Field(ge=1)
    priority: int = Field(ge=1)
    targets: list[Target]
    scoring: list[ScoringStat] = Field(default_factory=list, max_length=300)
    overshoot: Literal["ignore", "minimize", "reward"] = "ignore"
    keepEquipment: bool = True
    keepGems: bool = True
    previousEquipmentIds: dict[str, str] = Field(default_factory=dict)
    previousGemIds: dict[str, str] = Field(default_factory=dict)
class Request(BaseModel):
    requestId: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    castellan: bool = False
    objectiveOrder: list[ObjectiveStage] | None = None
    equipment: list[Equipment] = Field(max_length=1500)
    gems: list[Gem] = Field(max_length=1500)
    stats: list[Stat] = Field(max_length=300)
    jobs: list[Job] = Field(max_length=100)
    reservedEquipmentIds: list[str] = Field(default_factory=list)
    reservedGemIds: list[str] = Field(default_factory=list)
    maxAchieved: int | None = Field(default=None, ge=0, le=100)
    timeLimitSeconds: int = Field(default=60, ge=5, le=1800)
    @model_validator(mode="after")
    def check_ids(self):
        if self.objectiveOrder is not None and (len(self.objectiveOrder) != 4 or len(set(self.objectiveOrder)) != 4):
            raise ValueError("Invalid objective stage order")
        if len({e.id for e in self.equipment}) != len(self.equipment):
            raise ValueError("Duplicate equipment IDs")
        if len({g.id for g in self.gems}) != len(self.gems):
            raise ValueError("Duplicate gem IDs")
        if len({s.id for s in self.stats}) != len(self.stats):
            raise ValueError("Duplicate stat IDs")
        if len({(j.presetId, j.ordinal) for j in self.jobs}) != len(self.jobs):
            raise ValueError("Duplicate jobs")
        if any(len(set(g.allowedSlots)) != len(g.allowedSlots) for g in self.gems):
            raise ValueError("Duplicate gem slots")
        # Reject unsupported precision as a validation error, before starting a job.
        for value in ([e.value for item in [*self.equipment, *self.gems] for e in item.effects] +
                      [t.minValue for j in self.jobs for t in j.targets] +
                      [s.cap for s in self.stats if s.cap is not None]):
            scaled(value)
        return self

app = FastAPI(title="E4K CP-SAT Optimizer", version="1.0")
origins = [s.strip() for s in os.getenv("CORS_ORIGINS", "").split(",") if s.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])
@app.get("/health")
def health():
    return {"ok": True, "castellan": True}

@app.post("/optimize")
def optimize(data: Request):
    return solve_request(data)


def solve_request(data: Request, report=None):
    started_at = time.monotonic()
    if not data.jobs:
        return {"status": "OPTIMAL", "optimal": True, "achieved": 0, "upperBound": 0, "requested": 0, "builds": [], "countOptimal": True, "stages": [], "elapsedSeconds": 0}
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
    relevant_stats = {stat for job in data.jobs for t in job.targets for stat in (t.statId, t.npcBonusStatId) if stat}
    if data.castellan or data.objectiveOrder is not None:
        relevant_stats.update(stat.id for job in data.jobs for stat in job.scoring)
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
        signature = (job.presetId, job.priority, job.requireEquipment,
                     job.overshoot, job.keepEquipment, job.keepGems,
                     tuple(sorted(job.requiredEquipmentIds)),
                     tuple(sorted(job.previousEquipmentIds.items())),
                     tuple(sorted(job.previousGemIds.items())),
                     tuple(sorted((s.id, s.scale, s.weight) for s in job.scoring)),
                     tuple(sorted((t.statId, t.npcBonusStatId or '', scaled(t.minValue)) for t in job.targets)))
        if signature in previous_identical:
            model.Add(active[j] <= active[previous_identical[signature]])
        previous_identical[signature] = j
    # Require at least one named equipment item in every active build.
    for j, job in enumerate(data.jobs):
        if job.requireEquipment:
            allowed = set(job.requiredEquipmentIds)
            model.Add(sum(var for (job_idx, slot, eid), var in x.items()
                          if job_idx == j and eid in allowed) >= active[j])
    def capped(raw, cap, name):
        if cap is None:
            return raw
        value = model.NewIntVar(0, cap, name)
        model.AddMinEquality(value, [raw, cap])
        return value

    effective = {}

    def effective_stat(j, stat):
        key = (j, stat)
        if key not in effective:
            raw_equipment = sum(equipment_stat_terms[key])
            raw_gems = sum(gem_stat_terms[key])
            cap = caps.get(stat)
            if stat in ("S003", "C003"):
                value = capped(raw_equipment + raw_gems, cap, f"courtyard_{j}")
            else:
                gem_cap = None
                if data.castellan:
                    if stat == "C007":
                        gem_cap = caps.get("CG007")
                    elif stat.startswith(("CNG", "CPG")):
                        gem_cap = cap
                value = (capped(raw_equipment, cap, f"capped_eq_{j}_{stat}") +
                         capped(raw_gems, gem_cap, f"capped_gem_{j}_{stat}"))
            effective[key] = value
        return effective[key]

    target_values = {}
    for j, job in enumerate(data.jobs):
        for index, target in enumerate(job.targets):
            value = effective_stat(j, target.statId)
            if target.npcBonusStatId:
                value += sum(gem_stat_terms[j, target.npcBonusStatId])
            target_values[j, index] = value
            model.Add(value >= scaled(target.minValue) * active[j])

    count = sum(active)
    if data.maxAchieved is not None:
        model.Add(count <= data.maxAchieved)

    def stability_terms():
        retained = []
        for j, job in enumerate(data.jobs):
            if job.keepEquipment:
                for slot, eid in job.previousEquipmentIds.items():
                    var = x.get((j, slot, eid))
                    if var is not None:
                        retained.append(var)
            if job.keepGems and (job.previousEquipmentIds or job.previousGemIds):
                for slot in SLOTS:
                    gid = job.previousGemIds.get(slot)
                    if gid is None:
                        occupied = sum(y[j, slot, gem.id] for gem in gems_by_slot[slot])
                        retained.append(active[j] - occupied)
                    else:
                        var = y.get((j, slot, gid))
                        if var is not None:
                            retained.append(var)
        return retained

    def max_effect_totals():
        return {stat: len(SLOTS) * (
            max((e.get(stat, 0) for e in equipment_effects.values()), default=0) +
            max((g.get(stat, 0) for g in gem_effects.values()), default=0)
        ) for stat in relevant_stats}

    def normalized_points(expression, maximum, denominator, name):
        value = model.NewIntVar(0, maximum, f"{name}_value")
        model.Add(value == expression)
        points = model.NewIntVar(0, maximum * SCALE // denominator, name)
        model.AddDivisionEquality(points, value * SCALE, denominator)
        return points

    def weighted_terms():
        if not any(job.scoring for job in data.jobs):
            return []
        maxima = max_effect_totals()
        return [
            stat.weight * normalized_points(effective_stat(j, stat.id), maxima[stat.id],
                                            max(1, round(stat.scale * SCALE)), f"score_{j}_{index}")
            for j, job in enumerate(data.jobs) for index, stat in enumerate(job.scoring)
            if maxima[stat.id]
        ]

    def overshoot_terms():
        if all(job.overshoot == "ignore" for job in data.jobs):
            return []
        maxima = max_effect_totals()
        terms = []
        for j, job in enumerate(data.jobs):
            if job.overshoot == "ignore":
                continue
            for index, target in enumerate(job.targets):
                minimum = scaled(target.minValue)
                maximum = maxima[target.statId] + maxima.get(target.npcBonusStatId, 0)
                if maximum <= minimum:
                    continue
                excess = target_values[j, index] - minimum * active[j]
                points = normalized_points(excess, maximum - minimum, max(SCALE, minimum), f"excess_{j}_{index}")
                terms.append(points if job.overshoot == "reward" else -points)
        return terms

    max_priority = max(job.priority for job in data.jobs)
    priority = sum((max_priority + 1 - job.priority) * active[j] for j, job in enumerate(data.jobs))
    # Build all auxiliary variables before the first solve. Every incumbent can
    # then be evaluated for every later objective, including after a timeout.
    if data.objectiveOrder is None and not data.castellan:
        phases = [("priorityAndStability", (8 * n + 1) * priority + sum(stability_terms()))]
    else:
        terms = {
            "planPriority": [priority], "weighted": weighted_terms(),
            "overshoot": overshoot_terms(), "stability": stability_terms(),
        }
        phases = [(stage, sum(terms[stage])) for stage in
                  (data.objectiveOrder or ["planPriority", "weighted"]) if terms[stage]]
    phases.insert(0, ("count", count))
    static_bound = min(n, data.maxAchieved if data.maxAchieved is not None else n,
                       *(len(equipment_by_slot[slot]) for slot in SLOTS))
    stage_results = []
    best_solver = None
    achieved = 0
    bound = static_bound
    count_optimal = False
    all_proven = True
    decision_vars = [*active, *x.values(), *y.values()]

    # Existing assignments are useful starting suggestions, never locks.
    for j, job in enumerate(data.jobs):
        if all((j, slot, job.previousEquipmentIds.get(slot)) in x for slot in SLOTS):
            model.AddHint(active[j], 1)
            for slot in SLOTS:
                model.AddHint(x[j, slot, job.previousEquipmentIds[slot]], 1)
            for slot, gid in job.previousGemIds.items():
                if (j, slot, gid) in y:
                    model.AddHint(y[j, slot, gid], 1)

    def publish(stage, index):
        if report:
            report({"stage": stage, "stageIndex": index + 1, "stageCount": len(phases),
                    "achieved": achieved, "upperBound": bound, "countOptimal": count_optimal,
                    "elapsedSeconds": round(time.monotonic() - started_at, 1)})

    class IncumbentProgress(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            nonlocal achieved, bound
            if phase_id == "count":
                achieved = round(self.Value(count))
                bound = max(achieved, min(static_bound, math.floor(self.BestObjectiveBound() + 1e-6)))
            publish(phase_id, phase_index)

    for phase_index, (phase_id, objective) in enumerate(phases):
        if best_solver is not None:
            # A timeout in a later phase must never replace a better incumbent.
            model.Add(objective >= best_solver.Value(objective))
            model.ClearHints()
            for var in decision_vars:
                model.AddHint(var, best_solver.Value(var))
        model.Maximize(objective)
        publish(phase_id, phase_index)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = data.timeLimitSeconds
        solver.parameters.num_search_workers = max(1, min(8, int(os.getenv("CPSAT_WORKERS", "2"))))
        status = solver.Solve(model, IncumbentProgress())
        has_solution = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        if phase_id == "count":
            if has_solution:
                achieved = round(solver.Value(count))
                bound = max(achieved, min(static_bound, math.floor(solver.BestObjectiveBound() + 1e-6)))
                count_optimal = status == cp_model.OPTIMAL or achieved == bound
            else:
                # UNKNOWN's solver bound may be uninitialized; use a safe inventory bound.
                return {"status": solver.StatusName(status), "optimal": False,
                        "countOptimal": False, "achieved": 0, "upperBound": static_bound,
                        "requested": n, "builds": [], "stages": [],
                        "elapsedSeconds": round(time.monotonic() - started_at, 1)}
        if has_solution:
            best_solver = solver
        proven = status == cp_model.OPTIMAL
        all_proven = all_proven and proven
        stage_results.append({"id": phase_id, "status": solver.StatusName(status),
                              "value": best_solver.Value(objective),
                              "bound": solver.BestObjectiveBound() if has_solution else None})
        # Preserve the best value found, even if it is not yet proven optimal.
        # Later phases improve quality at that value instead of stopping early.
        model.Add(objective == best_solver.Value(objective))
        publish(phase_id, phase_index)
        if phase_id == "count" and achieved == 0:
            break
    final_status = "OPTIMAL" if all_proven else "FEASIBLE"
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
                            "actual": best_solver.Value(target_values[j, index]) / SCALE,
                            "missing": 0} for index, t in enumerate(job.targets)],
            "overflow": [{"statId": key, "cap": cap / SCALE, "raw": totals[key] / SCALE}
                         for key, cap in caps.items() if totals.get(key, 0) > cap]
        })
    return {"status": final_status,
            "upperBound": bound,
            "optimal": all_proven, "countOptimal": count_optimal,
            "stages": stage_results, "elapsedSeconds": round(time.monotonic() - started_at, 1),
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
        def report(progress):
            with _job_lock:
                _jobs[job_id]["progress"] = progress
        result = solve_request(data, report)
        with _job_lock:
            _jobs[job_id].update(state="completed", result=result, updated=time.monotonic())
    except Exception as exc:
        with _job_lock:
            _jobs[job_id].update(state="failed", error=str(exc), updated=time.monotonic())

@app.post("/jobs", status_code=202)
def start_job(data: Request):
    job_id = data.requestId or uuid.uuid4().hex
    fingerprint = sha256(data.model_dump_json().encode()).digest() if data.requestId else None
    with _job_lock:
        _expire_jobs()
        existing = _jobs.get(job_id)
        if existing is not None:
            if existing["fingerprint"] != fingerprint:
                raise HTTPException(status_code=409, detail="同じ依頼IDに異なる計算データが送信されました。")
            return {"jobId": job_id, "state": existing["state"], "castellan": data.castellan, "objectiveVersion": 1}
        # Free-tier instance: prevent unbounded CPU and memory queues.
        if any(job["state"] == "running" for job in _jobs.values()):
            raise HTTPException(status_code=429, detail="別の最適化を実行中です。完了後に再試行してください。")
        if len(_jobs) >= _MAX_JOBS:
            oldest = min(_jobs, key=lambda key: _jobs[key]["updated"])
            del _jobs[oldest]
        _jobs[job_id] = {"state": "running", "updated": time.monotonic(), "fingerprint": fingerprint}
    _executor.submit(_run_job, job_id, data)
    return {"jobId": job_id, "state": "running", "castellan": data.castellan, "objectiveVersion": 1}

@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    with _job_lock:
        _expire_jobs()
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="計算ジョブが見つかりません。サーバー再起動の可能性があります。")
        response = {"jobId": job_id, "state": job["state"]}
        if "progress" in job:
            response["progress"] = job["progress"]
        if "result" in job:
            response["result"] = job["result"]
        if "error" in job:
            response["error"] = job["error"]
        return response

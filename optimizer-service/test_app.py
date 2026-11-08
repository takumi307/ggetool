from fastapi.testclient import TestClient
from app import app

client = TestClient(app)
def equipment(eid, slot, amount):
    return {"id": eid, "slotType": slot, "effects": [{"statId": "power", "value": amount}]}
def payload():
    return {
        "equipment": [
            equipment("h1", "helmet", 10), equipment("h2", "helmet", 10),
            equipment("w1", "weapon", 0), equipment("w2", "weapon", 0),
            equipment("a1", "armor", 0), equipment("a2", "armor", 0),
            equipment("r1", "artifact", 0), equipment("r2", "artifact", 0)
        ],
        "gems": [], "stats": [{"id": "power", "capStatus": "known", "cap": 20}],
        "jobs": [
            {"presetId": "p", "ordinal": 1, "priority": 1, "targets": [{"statId": "power", "minValue": 10}]},
            {"presetId": "p", "ordinal": 2, "priority": 1, "targets": [{"statId": "power", "minValue": 10}]}
        ], "timeLimitSeconds": 10
    }

def test_optimal_two_builds():
    r = client.post("/optimize", json=payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "OPTIMAL"
    assert body["optimal"] is True
    assert body["achieved"] == 2
    assert len({id for b in body["builds"] for id in b["equipmentIds"].values()}) == 8

def test_reservation_prevents_reuse():
    p = payload()
    p["reservedEquipmentIds"] = ["h1"]
    body = client.post("/optimize", json=p).json()
    assert body["achieved"] == 1
    assert all("h1" not in b["equipmentIds"].values() for b in body["builds"])

def test_impossible_cap():
    p = payload()
    p["stats"][0]["cap"] = 5
    body = client.post("/optimize", json=p).json()
    assert body["optimal"] is True
    assert body["achieved"] == 0

def test_async_job_returns_result():
    import time
    start = client.post("/jobs", json=payload())
    assert start.status_code == 202, start.text
    job_id = start.json()["jobId"]
    assert len(job_id) == 32
    for _ in range(100):
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        body = response.json()
        if body["state"] == "completed":
            assert body["result"]["achieved"] == 2
            return
        assert body["state"] == "running", body
        time.sleep(0.1)
    raise AssertionError("Asynchronous optimization did not complete")

def test_identical_jobs_keep_original_optimum():
    p = payload()
    p["jobs"].append({"presetId": "p", "ordinal": 3, "priority": 1,
                      "targets": [{"statId": "power", "minValue": 10}]})
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["achieved"] == 2
    assert [b["ordinal"] for b in result["builds"]] == [1, 2]

def test_distinct_priorities_preserved():
    p = payload()
    p["jobs"][0]["priority"] = 2
    p["jobs"][1]["priority"] = 1
    p["reservedEquipmentIds"] = ["h1"]
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["achieved"] == 1
    assert result["builds"][0]["ordinal"] == 2

def test_optimal_bound_matches_achieved():
    result = client.post("/optimize", json=payload()).json()
    assert result["status"] == "OPTIMAL"
    assert result["upperBound"] == result["achieved"] == 2

def test_impossible_cap_upper_bound_zero():
    p = payload()
    p["stats"][0]["cap"] = 5
    result = client.post("/optimize", json=p).json()
    assert result["upperBound"] == result["achieved"] == 0


def test_gem_bonus_can_exceed_equipment_cap():
    p = payload()
    p["equipment"][0]["effects"][0]["value"] = 160
    p["stats"][0]["cap"] = 140
    p["gems"] = [{"id": "g1", "allowedSlots": ["helmet"],
                  "effects": [{"statId": "power", "value": 20}]}]
    p["jobs"] = [{"presetId": "p", "ordinal": 1, "priority": 1,
                  "targets": [{"statId": "power", "minValue": 150}]}]
    result = client.post("/optimize", json=p).json()
    assert result["status"] == "OPTIMAL", result
    assert result["achieved"] == 1
    assert result["builds"][0]["shortfalls"][0]["actual"] == 160


def test_equipment_cap_without_gem_still_limits_target():
    p = payload()
    p["equipment"][0]["effects"][0]["value"] = 160
    p["stats"][0]["cap"] = 140
    p["jobs"] = [{"presetId": "p", "ordinal": 1, "priority": 1,
                  "targets": [{"statId": "power", "minValue": 150}]}]
    result = client.post("/optimize", json=p).json()
    assert result["achieved"] == 0


def test_required_equipment_per_commander():
    p = payload()
    p["jobs"][0]["requireEquipment"] = True
    p["jobs"][0]["requiredEquipmentIds"] = ["h1"]
    p["jobs"][1]["requireEquipment"] = True
    p["jobs"][1]["requiredEquipmentIds"] = ["h1"]
    result = client.post("/optimize", json=p).json()
    assert result["achieved"] == 1
    assert "h1" in result["builds"][0]["equipmentIds"].values()


def test_required_equipment_missing_means_no_build():
    p = payload()
    p["jobs"][0]["requireEquipment"] = True
    p["jobs"][0]["requiredEquipmentIds"] = []
    p["jobs"][1]["requireEquipment"] = True
    p["jobs"][1]["requiredEquipmentIds"] = []
    result = client.post("/optimize", json=p).json()
    assert result["achieved"] == 0


def test_reoptimization_prefers_original_equipment_when_goals_equal():
    p = payload()
    p["jobs"][0]["previousEquipmentIds"] = {
        "helmet": "h2", "weapon": "w2", "armor": "a2", "artifact": "r2"
    }
    p["jobs"][1]["previousEquipmentIds"] = {
        "helmet": "h1", "weapon": "w1", "armor": "a1", "artifact": "r1"
    }
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["achieved"] == 2
    by_job = {b["ordinal"]: b["equipmentIds"] for b in result["builds"]}
    assert by_job[1] == p["jobs"][0]["previousEquipmentIds"]
    assert by_job[2] == p["jobs"][1]["previousEquipmentIds"]


def test_partial_reoptimization_can_choose_later_commander_to_retain_gear():
    p = payload()
    p["reservedEquipmentIds"] = ["h2"]
    p["jobs"][1]["previousEquipmentIds"] = {
        "helmet": "h1", "weapon": "w1", "armor": "a1", "artifact": "r1"
    }
    p["jobs"][1]["previousGemIds"] = {"weapon": "g1"}
    p["gems"] = [{"id": "g1", "allowedSlots": ["helmet", "weapon"], "effects": []}]
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["achieved"] == 1
    build = result["builds"][0]
    assert build["ordinal"] == 2
    assert build["equipmentIds"] == p["jobs"][1]["previousEquipmentIds"]
    assert build["gemAssignments"] == [{"slotType": "weapon", "gemId": "g1"}]


def test_roster_capacity_keeps_achievable_jobs_beyond_first_candidate():
    p = payload()
    p["maxAchieved"] = 1
    p["jobs"][0]["targets"][0]["minValue"] = 21
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["achieved"] == 1
    assert result["builds"][0]["ordinal"] == 2


def test_reoptimization_prefers_fewer_changes_in_empty_gem_slots():
    p = payload()
    p["jobs"] = [p["jobs"][0]]
    p["jobs"][0]["targets"][0]["minValue"] = 15
    p["jobs"][0]["previousEquipmentIds"] = {
        "helmet": "h1", "weapon": "w1", "armor": "a1", "artifact": "r1"
    }
    p["gems"] = [
        {"id": "small1", "allowedSlots": ["helmet"], "effects": [{"statId": "power", "value": 2}]},
        {"id": "small2", "allowedSlots": ["weapon"], "effects": [{"statId": "power", "value": 3}]},
        {"id": "large", "allowedSlots": ["armor"], "effects": [{"statId": "power", "value": 5}]},
    ]
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] is True
    assert result["builds"][0]["gemAssignments"] == [{"slotType": "armor", "gemId": "large"}]

def test_castellan_prioritizes_targets_and_weighted_secondary_effects():
    p = payload()
    p["castellan"] = True
    p["jobs"] = p["jobs"][:1]
    p["jobs"][0]["scoring"] = [
        {"id": "C007", "scale": 50, "weight": 5},
        {"id": "C004", "scale": 160, "weight": 1},
    ]
    p["equipment"][0]["effects"] += [{"statId": "C004", "value": 160}, {"statId": "C011", "value": 50}]
    p["equipment"][1]["effects"] += [{"statId": "C007", "value": 15}]
    p["equipment"].append({"id": "short", "slotType": "helmet", "effects": [
        {"statId": "power", "value": 9}, {"statId": "C007", "value": 50},
    ]})
    response = client.post("/optimize", json=p)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["optimal"] is True
    assert body["builds"][0]["equipmentIds"]["helmet"] == "h2"

def test_castellan_uses_shared_courtyard_and_separate_wall_gem_caps():
    p = payload()
    p["castellan"] = True
    p["jobs"] = p["jobs"][:1]
    p["stats"] += [
        {"id": "C003", "capStatus": "known", "cap": 100},
        {"id": "C007", "capStatus": "known", "cap": 50},
        {"id": "CG007", "capStatus": "known", "cap": 10},
    ]
    for item in p["equipment"][:2]:
        item["effects"] += [{"statId": "C003", "value": 90}, {"statId": "C007", "value": 60}]
    p["gems"] = [{"id": "gem", "allowedSlots": ["helmet"], "effects": [
        {"statId": "C003", "value": 30}, {"statId": "C007", "value": 20},
    ]}]
    p["jobs"][0]["targets"] = [
        {"statId": "C003", "minValue": 100}, {"statId": "C007", "minValue": 60},
    ]
    body = client.post("/optimize", json=p).json()
    assert [t["actual"] for t in body["builds"][0]["shortfalls"]] == [100, 60]
    for i in range(2):
        p["jobs"][0]["targets"][i]["minValue"] += 1
        assert client.post("/optimize", json=p).json()["achieved"] == 0
        p["jobs"][0]["targets"][i]["minValue"] -= 1

def test_job_submission_is_idempotent():
    p = payload()
    p["requestId"] = "ab" * 16
    first = client.post("/jobs", json=p)
    repeated = client.post("/jobs", json=p)
    assert first.status_code == repeated.status_code == 202
    assert first.json()["jobId"] == repeated.json()["jobId"] == p["requestId"]
    changed = {**p, "timeLimitSeconds": 20}
    assert client.post("/jobs", json=changed).status_code == 409
    from app import _executor
    _executor.submit(lambda: None).result(timeout=15)

OBJECTIVE_ORDER = ["planPriority", "weighted", "overshoot", "stability"]

def test_custom_weight_order_changes_result_before_stability():
    p = payload()
    p["jobs"] = p["jobs"][:1]
    job = p["jobs"][0]
    job["previousEquipmentIds"] = {"helmet": "h1"}
    job["scoring"] = [{"id": "speed", "scale": 20, "weight": 2}]
    p["equipment"][1]["effects"].append({"statId": "speed", "value": 20})
    p["objectiveOrder"] = OBJECTIVE_ORDER
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] and result["builds"][0]["equipmentIds"]["helmet"] == "h2"
    p["objectiveOrder"] = ["planPriority", "stability", "weighted", "overshoot"]
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] and result["builds"][0]["equipmentIds"]["helmet"] == "h1"
    job["keepEquipment"] = False
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] and result["builds"][0]["equipmentIds"]["helmet"] == "h2"

def test_custom_overshoot_minimize_or_reward():
    p = payload()
    p["jobs"] = p["jobs"][:1]
    p["equipment"][1]["effects"][0]["value"] = 15
    p["objectiveOrder"] = OBJECTIVE_ORDER
    for mode, helmet in [("minimize", "h1"), ("reward", "h2")]:
        p["jobs"][0]["overshoot"] = mode
        result = client.post("/optimize", json=p).json()
        assert result["optimal"] and result["builds"][0]["equipmentIds"]["helmet"] == helmet

def test_custom_overshoot_never_sacrifices_count():
    p = payload()
    p["equipment"][1]["effects"][0]["value"] = 15
    p["objectiveOrder"] = ["overshoot", "weighted", "planPriority", "stability"]
    for job in p["jobs"]:
        job["overshoot"] = "minimize"
    result = client.post("/optimize", json=p).json()
    assert result["optimal"] and result["achieved"] == 2

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

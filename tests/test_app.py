import datetime as dt
import re
import threading

import pytest

from dashboard import auth
from dashboard.app import create_app
from dashboard.data import ApiData, DemoData


@pytest.fixture(autouse=True)
def plain_http(monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "0")


def login(client, name, pw):
    page = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="csrf" value="([^"]+)"', page).group(1)
    return client.post("/login", data={"name": name, "password": pw, "csrf": token})


def test_login_needed_and_demo_user():
    c = create_app(DemoData()).test_client()
    assert c.get("/").status_code == 302 and c.get("/api/sites").status_code == 401
    assert c.get("/cam/iswm-donthali/front.mjpg").status_code == 401
    assert "demo1234" in c.get("/login").get_data(as_text=True)
    assert login(c, "demo", "wrong").status_code == 401
    assert login(c, "demo", "demo1234").status_code == 302
    d = c.get("/api/sites").get_json()
    assert d["demo"] and len(d["sites"]) == 8
    s = d["sites"][0]
    assert {"id", "name", "online", "last_sync", "cameras", "today"} <= set(s)
    assert s["cameras"][2] == ["cam3", "Tipping floor"]


def test_login_form_needs_token_and_wrong_passwords_wait():
    c = create_app(DemoData()).test_client()
    assert c.post("/login", data={"name": "demo", "password": "demo1234"}).status_code == 400  # no CSRF token
    for _ in range(5):
        login(c, "demo", "nope")
    assert login(c, "demo", "demo1234").status_code == 429  # blocked for a minute


def test_real_users_and_site_limits():
    users = auth.load_users("boss:%s;kadiri:%s@iswm-kadiri" % (auth.hash_password("Boss2026x"),
                                                               auth.hash_password("Kadiri2026")), demo=True)
    assert "demo" not in users  # demo user only when nobody is set up
    app = create_app(DemoData(), users=users)
    c = app.test_client()
    login(c, "kadiri", "Kadiri2026")
    ids = [s["id"] for s in c.get("/api/sites").get_json()["sites"]]
    assert ids == ["iswm-kadiri"]
    assert c.get("/site/iswm-donthali").status_code == 404
    assert c.get("/api/sites/iswm-donthali/trips").status_code == 404
    assert c.get("/site/iswm-kadiri").status_code == 200
    b = app.test_client()
    login(b, "boss", "Boss2026x")
    assert len(b.get("/api/sites").get_json()["sites"]) == 8


def test_demo_pages_trips_chart_and_camera():
    c = create_app(DemoData()).test_client()
    login(c, "demo", "demo1234")
    assert "Tipping floor" not in c.get("/").get_data(as_text=True)  # names come by JS, page is just the frame
    assert c.get("/site/iswm-donthali").status_code == 200
    y = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    t = c.get("/api/sites/iswm-donthali/trips?date=" + y).get_json()
    assert len(t["trips"]) > 10 and t["trips"] == c.get("/api/sites/iswm-donthali/trips?date=" + y).get_json()["trips"]
    assert len(c.get("/api/sites/iswm-donthali/daily").get_json()["days"]) == 14
    live = c.get("/api/sites/iswm-donthali/live").get_json()
    assert live["plant_online"] and ["cam4", "Windrow yard"] in live["cams"]
    r = c.get("/cam/iswm-donthali/cam3.mjpg?q=low")
    assert r.mimetype == "multipart/x-mixed-replace"
    first = next(r.response)
    assert first.startswith(b"--frame") and b"\xff\xd8" in first
    r.close()
    assert c.get("/cam/iswm-donthali/cam9.mjpg").status_code == 404  # no such camera
    assert c.get("/cam/iswm-kurnool/front.mjpg").status_code == 404  # plant offline


def test_status_board_hourly_shifts_and_csv():
    c = create_app(DemoData()).test_client()
    login(c, "demo", "demo1234")
    sites = {s["id"]: s for s in c.get("/api/sites").get_json()["sites"]}
    assert sites["iswm-kurnool"]["health"]["state"] == "offline"
    assert sites["iswm-guntur"]["health"]["reasons"] == ["Weighbridge not connected"]
    assert sites["iswm-tirupati"]["health"]["reasons"] == ["Camera problem: Compost yard"]
    assert sites["iswm-donthali"]["health"]["state"] == "ok"
    t = sites["iswm-donthali"]["today"]
    assert len(t["in_by_hour"]) == 24 and sum(t["in_by_hour"]) + sum(t["out_by_hour"]) >= t["in_trips"] + t["out_trips"]
    y = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    r = c.get("/api/sites/iswm-donthali/day?date=" + y).get_json()
    trips = c.get("/api/sites/iswm-donthali/trips?date=" + y).get_json()["trips"]
    assert len(r["hours"]) == 24 and sum(h["in"] + h["out"] for h in r["hours"]) == len(trips)
    assert sum(s["in"]["trips"] + s["out"]["trips"] for s in r["shifts"]) == len(trips)  # every trip in one shift
    assert r["in"]["kg"] == sum(x["kg"] for x in r["waste"]) == sum(x["kg"] for x in r["source"])
    assert r["out"]["kg"] == sum(x["kg"] for x in r["material"])
    assert len(r["vehicles"]) <= 10 and r["busiest"]["hour"] in range(24)
    csv_text = c.get("/api/sites/iswm-donthali/trips.csv?date=" + y).get_data(as_text=True)
    assert csv_text.startswith("\ufeffDate,Time,Ticket") and csv_text.count("\n") == len(trips) + 1
    assert c.get("/api/sites/iswm-donthali/day?date=nonsense").status_code == 400


def test_health_rules():
    from dashboard.data import health
    now = dt.datetime.now()
    assert health(True, now, {"wb": True, "cam_problems": [], "queued": 3, "sync": "synced"})["state"] == "ok"
    h = health(True, now, {"wb": True, "cam_problems": [], "queued": 500, "sync": "error"})
    assert h["state"] == "attention" and h["reasons"] == ["Cloud sync error", "500 records waiting to sync"]
    assert health(False, None, None)["reasons"] == ["Never connected"]


def test_reads_the_real_iswm_api_and_passes_cameras_through():
    """Against a stand-in for cloud_api: same paths and answers, API key checked."""
    from flask import Flask, Response, jsonify, request
    from werkzeug.serving import make_server
    api = Flask("fake")
    today = dt.date.today().isoformat()
    seen = []

    @api.before_request
    def key():
        seen.append(request.headers.get("X-API-Key"))

    @api.get("/v1/sites")
    def sites():
        return jsonify([{"id": "iswm-donthali", "name": "ISWM Donthali", "company": "Lions Group",
                         "last_sync": dt.datetime.now(dt.timezone.utc).isoformat(),
                         "cameras": [{"id": "front", "name": "Front cam"}, {"id": "cam3", "name": "Tipping floor"}],
                         "today": {"date": today, "in_trips": 3, "in_kg": 12000, "out_trips": 1, "out_kg": 4000,
                                   "pending": 1}}])

    @api.get("/v1/sites/<site>/entries")
    def entries(site):
        return jsonify([{"id": "INR26100001", "dir": "in", "vno": "AP39TB1234", "created_at": today + "T09:15:00+05:30",
                         "waste_type": "Mixed", "source": "Residential", "gross_kg": 9000, "tare_kg": 6000,
                         "net_kg": 3000, "operator": "Ramesh"}])

    @api.get("/v1/live/status")
    def board():
        return jsonify({"iswm-donthali": {"online": True, "seen_s": 4, "cams": [["front", "Front cam"]],
                                          "status": {"ver": "1.5.0", "wb": False, "cams": 2, "cam_problems": [],
                                                     "queued": 0, "sync": "synced", "operator": "Ramesh"}}})

    @api.get("/v1/sites/<site>/live/state")
    def state(site):
        return jsonify({"plant_online": True, "cams": [["front", "Front cam"], ["cam3", "Tipping floor"]],
                        "weight": {"connected": True, "weight": 7200, "stable": True}})

    @api.get("/v1/sites/<site>/live/<cam>.mjpg")
    def mjpg(site, cam):
        return Response(iter([b"--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff\xd8RELAY-" + cam.encode() + b"\r\n"]),
                        mimetype="multipart/x-mixed-replace; boundary=frame")

    srv = make_server("127.0.0.1", 0, api, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        data = ApiData("http://127.0.0.1:%d" % srv.server_port, "dash-key")
        c = create_app(data, users=auth.load_users("boss:" + auth.hash_password("Boss2026x"), demo=False)).test_client()
        login(c, "boss", "Boss2026x")
        s = c.get("/api/sites").get_json()["sites"][0]
        assert s["online"] and s["today"]["in_kg"] == 12000 and s["cameras"][1] == ["cam3", "Tipping floor"]
        assert s["health"]["state"] == "attention" and s["health"]["operator"] == "Ramesh"  # weighbridge off, from relay
        assert s["today"]["in_by_hour"] == [0] * 24  # older plant without hourly counts still works
        assert c.get("/api/sites/iswm-donthali/trips").get_json()["trips"][0]["vno"] == "AP39TB1234"
        days = c.get("/api/sites/iswm-donthali/daily").get_json()["days"]
        assert days[-1]["in_kg"] == 3000 and days[-1]["date"] == today
        assert c.get("/api/sites/iswm-donthali/live").get_json()["weight"]["weight"] == 7200
        body = c.get("/cam/iswm-donthali/cam3.mjpg").get_data()
        assert b"RELAY-cam3" in body
        assert set(seen) == {"dash-key"}  # key used by this server; never sent to the browser
        assert "dash-key" not in c.get("/site/iswm-donthali").get_data(as_text=True)
    finally:
        srv.shutdown()

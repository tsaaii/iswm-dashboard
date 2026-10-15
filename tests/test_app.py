import datetime as dt
import re
import threading

import pytest

from dashboard import auth, registry
from dashboard.app import create_app
from dashboard.data import ApiData, DemoData


@pytest.fixture(autouse=True)
def plain_http(monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "0")


def login(client, name, pw):
    page = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="csrf" value="([^"]+)"', page).group(1)
    return client.post("/login", data={"name": name, "password": pw, "csrf": token})


def test_registry_matches_the_package_sheet():
    assert len(registry.ULBS) == 107 and len(registry.PACKAGES) == 10
    assert sorted(registry.OPS) == ["anantapur", "badvel", "betamcherla", "kamalapuram", "kondapalli", "narsipatnam",
                                    "nellore", "peddapuram", "yeleswaram"]
    assert registry.describe(registry.parse_scope("")) == ("All sites", "All 107 ULBs")
    assert registry.describe(registry.parse_scope("nellore")) == ("Site", "ISWM Nellore")
    assert registry.describe(registry.parse_scope("pkg:1")) == ("Agency", "Package 1 · 16 ULBs")
    assert registry.describe(registry.parse_scope("pkg:7|8|9|10")) == ("Multi-site", "Packages 7–10 · 34 ULBs")


def test_public_landing_needs_no_login_and_shows_no_vehicles():
    c = create_app(DemoData()).test_client()
    assert c.get("/").status_code == 200
    d = c.get("/api/public/live").get_json()
    assert len(d["hours"]) == 24 and sum(d["hours"]) == d["trips"] and len(d["ops"]) == 9 and d["total_ulbs"] == 107
    y = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    one = c.get("/api/public/live?day=%s&ulb=nellore" % y).get_json()
    assert one["day"] == y and one["trips"] > 0
    assert "AP " not in c.get("/api/public/live?ulb=nellore").get_data(as_text=True)  # no vehicle numbers in public
    up = c.get("/api/public/upcoming").get_json()
    assert len(up["ulbs"]) == 107 and up["awarded_tpd"] == registry.AWARDED_TPD
    assert c.get("/app").status_code == 302 and c.get("/api/trips").status_code == 401


def test_login_and_scope_per_role():
    c = create_app(DemoData()).test_client()
    assert "admin@sac" in c.get("/login").get_data(as_text=True)
    assert login(c, "admin", "wrong").status_code == 401
    assert login(c, "admin", "admin@sac").status_code == 302
    me = c.get("/api/me").get_json()
    assert me["access"] == "All sites" and len(me["ulbs"]) == 107 and len(me["ops"]) == 9
    s = create_app(DemoData()).test_client()
    login(s, "nellore.site", "admin@sac")
    me = s.get("/api/me").get_json()
    assert (me["access"], me["scope"], me["ops"]) == ("Site", "ISWM Nellore", ["nellore"])
    y = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    tr = s.get("/api/trips?ids=nellore,badvel&from=%s&to=%s" % (y, y)).get_json()["trips"]
    assert tr and {t["site"] for t in tr} == {"nellore"}  # badvel is not theirs: dropped
    assert s.get("/api/cams/badvel").status_code == 404 and s.get("/cam/badvel/front.mjpg").status_code == 404
    m = create_app(DemoData()).test_client()
    login(m, "dyee.varaprasad", "admin@sac")
    assert m.get("/api/me").get_json()["ops"] == ["kamalapuram", "badvel", "anantapur", "betamcherla"]


def test_trips_sync_cameras_and_limits():
    c = create_app(DemoData()).test_client()
    login(c, "admin", "admin@sac")
    y = dt.date.today() - dt.timedelta(days=1)
    tr = c.get("/api/trips?from=%s&to=%s" % (y - dt.timedelta(days=6), y)).get_json()["trips"]
    t = tr[0]
    assert {"site", "date", "min", "veh", "dir", "mat", "gross", "tare", "net", "dest", "ticket"} <= set(t)
    assert {x["dir"] for x in tr} == {"IN", "OUT"} and {x["mat"] for x in tr if x["dir"] == "OUT"} <= {"RDF", "Compost", "Recyclables", "Inerts"}
    assert c.get("/api/trips?from=2020-01-01&to=2026-12-31").status_code == 400  # too long a range
    assert c.get("/api/sync").get_json()["kamalapuram"] == 140
    cams = c.get("/api/cams/nellore").get_json()["cams"]
    assert cams[2] == ["cam3", "Tipping floor"]
    r = c.get("/cam/nellore/cam3.mjpg?q=low")
    first = next(r.response)
    assert first.startswith(b"--frame") and b"\xff\xd8" in first
    r.close()


def test_login_form_needs_token_and_wrong_passwords_wait():
    c = create_app(DemoData()).test_client()
    assert c.post("/login", data={"name": "admin", "password": "admin@sac"}).status_code == 400  # no CSRF token
    for _ in range(5):
        login(c, "admin", "nope")
    assert login(c, "admin", "admin@sac").status_code == 429


def test_real_users_replace_demo_users():
    users = auth.load_users("ravi:%s@pkg:1#Iway Associates" % auth.hash_password("Iway2026x"), demo=True)
    assert set(users) == {"ravi"} and users["ravi"]["who"] == "Iway Associates"
    c = create_app(DemoData(), users=users).test_client()
    assert "admin@sac" not in c.get("/login").get_data(as_text=True)
    login(c, "ravi", "Iway2026x")
    me = c.get("/api/me").get_json()
    assert (me["access"], me["who"]) == ("Agency", "Iway Associates") and len(me["ulbs"]) == 16


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
        return jsonify([{"id": "iswm-nellore", "name": "ISWM Nellore", "last_sync": dt.datetime.now(dt.timezone.utc).isoformat(),
                         "cameras": [{"id": "front", "name": "Front cam"}]}])

    @api.get("/v1/sites/<site>/entries")
    def entries(site):
        return jsonify([{"id": "INR26100001", "dir": "in", "vno": "AP39TB1234", "created_at": today + "T09:15:00+05:30",
                         "waste_type": "Wet", "gross_kg": 9000, "tare_kg": 6000, "net_kg": 3000},
                        {"id": "O26100001", "dir": "out", "vno": "AP39TB9", "created_at": today + "T10:05:00+05:30",
                         "material": "RDF bales", "dest": "Ultratech cement", "gross_kg": 15000, "tare_kg": 7000,
                         "net_kg": 8000}])

    @api.get("/v1/sites/<site>/live/state")
    def state(site):
        return jsonify({"plant_online": True, "cams": [["front", "Front cam"], ["cam3", "Tipping floor"]]})

    @api.get("/v1/sites/<site>/live/<cam>.mjpg")
    def mjpg(site, cam):
        return Response(iter([b"--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff\xd8RELAY-" + cam.encode() + b"\r\n"]),
                        mimetype="multipart/x-mixed-replace; boundary=frame")

    srv = make_server("127.0.0.1", 0, api, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        data = ApiData("http://127.0.0.1:%d" % srv.server_port, "dash-key", site_map="")
        users = auth.load_users("boss:" + auth.hash_password("Boss2026x"), demo=False)
        c = create_app(data, users=users).test_client()
        pub = c.get("/api/public/live?ulb=nellore").get_json()
        assert pub["trips"] == 1 and pub["kg"] == 3000 and pub["hours"][9] == 1
        login(c, "boss", "Boss2026x")
        tr = c.get("/api/trips?ids=nellore&from=%s&to=%s" % (today, today)).get_json()["trips"]
        assert [(t["dir"], t["mat"], t["min"]) for t in tr] == [("IN", "Wet", 555), ("OUT", "RDF", 605)]
        assert tr[1]["dest"] == "Ultratech cement"
        assert c.get("/api/trips?ids=badvel&from=%s&to=%s" % (today, today)).get_json()["trips"] == []  # no plant yet
        assert c.get("/api/sync?ids=nellore,badvel").get_json() == {"nellore": 0, "badvel": None}
        assert c.get("/api/cams/nellore").get_json()["cams"][1] == ["cam3", "Tipping floor"]
        assert b"RELAY-cam3" in c.get("/cam/nellore/cam3.mjpg").get_data()
        assert set(seen) == {"dash-key"}  # key used by this server only
        assert "dash-key" not in c.get("/app").get_data(as_text=True)
    finally:
        srv.shutdown()

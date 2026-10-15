"""ISWM dashboard: every plant on one screen, with login, totals, trips and live cameras.

Run locally:   python -m dashboard.app        then open http://127.0.0.1:8080
Settings (environment variables):
    ISWM_API_URL     address of the ISWM shared API on Cloud Run (empty = demo data)
    ISWM_API_KEY     an API key that cloud_api accepts (API_KEYS there)
    DASHBOARD_USERS  who may log in (see auth.py)
    SECRET_KEY       long random text that signs the login cookie
"""
import csv
import datetime as dt
import io
import os
import re
import secrets
from functools import wraps

from flask import (Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for)

from . import auth
from .data import ApiData, DemoData, today

SITE_ID = re.compile(r"[a-z0-9-]{1,60}")
SHIFTS = [s.strip() for s in os.environ.get("SHIFT_STARTS", "06:00,14:00,22:00").split(",") if s.strip()]


def day_report(trips):
    """Everything the plant page shows for one day, from that day's trips."""
    def agg(rows):
        done = [r for r in rows if r["net_kg"] is not None]
        return {"trips": len(rows), "done": len(done), "kg": sum(r["net_kg"] for r in done)}

    def by(rows, key):
        groups = {}
        for r in rows:
            groups.setdefault(r.get(key) or "Other", []).append(r)
        return sorted(({"label": k, **agg(v)} for k, v in groups.items()), key=lambda x: -x["kg"])

    ins = [t for t in trips if t["dir"] == "in"]
    outs = [t for t in trips if t["dir"] == "out"]
    hours = [{"hour": h, "in": sum(1 for t in ins if int(t["time"][11:13]) == h),
              "out": sum(1 for t in outs if int(t["time"][11:13]) == h),
              "in_kg": sum(t["net_kg"] or 0 for t in ins if int(t["time"][11:13]) == h),
              "out_kg": sum(t["net_kg"] or 0 for t in outs if int(t["time"][11:13]) == h)} for h in range(24)]
    mins = [int(x[:2]) * 60 + int(x[3:5]) for x in SHIFTS]

    def shift_of(t):
        m = int(t["time"][11:13]) * 60 + int(t["time"][14:16])
        idx = [i for i, start in enumerate(mins) if m >= start]
        return idx[-1] if idx else len(mins) - 1  # before the first start = the night shift

    shifts = []
    for i, start in enumerate(SHIFTS):
        end = SHIFTS[(i + 1) % len(SHIFTS)]
        shifts.append({"label": "Shift %d" % (i + 1), "time": start + "–" + end,
                       "in": agg([t for t in ins if shift_of(t) == i]), "out": agg([t for t in outs if shift_of(t) == i])})
    vehicles = {}
    for t in trips:
        v = vehicles.setdefault(t["vno"], {"vno": t["vno"], "trips": 0, "in_kg": 0, "out_kg": 0, "pending": 0})
        v["trips"] += 1
        if t["net_kg"] is None:
            v["pending"] += 1
        else:
            v[t["dir"] + "_kg"] += t["net_kg"]
    busiest = max(hours, key=lambda h: h["in"] + h["out"])
    return {"in": agg(ins), "out": agg(outs), "hours": hours,
            "busiest": busiest if busiest["in"] + busiest["out"] else None,
            "shifts": shifts, "waste": by(ins, "what"), "source": by(ins, "where"),
            "material": by(outs, "what"), "dest": by(outs, "where"),
            "vehicles": sorted(vehicles.values(), key=lambda v: (-v["trips"], -(v["in_kg"] + v["out_kg"])))[:10],
            "pending": [t for t in ins if t["net_kg"] is None]}
CAM_ID = re.compile(r"front|back|cam[3-9]")


def create_app(source=None, users=None):
    app = Flask(__name__)
    url = os.environ.get("ISWM_API_URL", "").strip()
    app.data = source or (ApiData(url, os.environ.get("ISWM_API_KEY", "")) if url else DemoData())
    app.users = users if users is not None else auth.load_users(os.environ.get("DASHBOARD_USERS"), app.data.demo)
    app.secret_key = auth.secret_key()
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") != "0",
                      PERMANENT_SESSION_LIFETIME=dt.timedelta(hours=12))
    throttle = auth.Throttle()

    # --- login ------------------------------------------------------------------------------
    def current():
        name = session.get("user")
        return name if name in app.users else None

    def allowed(site_id):
        name = current()
        sites = app.users[name][1] if name else set()
        return name is not None and (not sites or site_id in sites)

    def login_required(fn):
        @wraps(fn)
        def wrap(*a, **k):
            if not current():
                if request.path.startswith(("/api/", "/cam/")):
                    abort(401)
                return redirect(url_for("login", next=request.path))
            return fn(*a, **k)
        return wrap

    def csrf_token():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        return session["csrf"]

    def check_csrf():
        sent, want = request.form.get("csrf", ""), session.get("csrf", "")
        if not want or not secrets.compare_digest(sent, want):
            abort(400, "The page was open too long. Reload and try again.")

    app.jinja_env.globals["csrf_token"] = csrf_token

    @app.after_request
    def headers(r):
        r.headers.setdefault("X-Content-Type-Options", "nosniff")
        r.headers.setdefault("X-Frame-Options", "DENY")
        r.headers.setdefault("Referrer-Policy", "same-origin")
        r.headers.setdefault("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'")
        if request.path.startswith(("/api/", "/cam/")) or current():
            r.headers["Cache-Control"] = "no-store"
        return r

    @app.get("/login")
    def login():
        if current():
            return redirect(url_for("overview"))
        return render_template("login.html", demo=app.data.demo and auth.DEMO_USER[0] in app.users,
                               demo_user=auth.DEMO_USER, no_users=not app.users)

    @app.post("/login")
    def login_post():
        check_csrf()
        name = request.form.get("name", "").strip()
        pw = request.form.get("password", "")
        ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
        nxt = request.form.get("next", "")
        if throttle.blocked("ip:" + ip, "user:" + name):
            return render_template("login.html", error="Too many tries. Wait a minute.", name=name), 429
        user = app.users.get(name)
        if not user or not auth.check_password(pw, user[0]):
            throttle.failed("ip:" + ip, "user:" + name)
            return render_template("login.html", error="Wrong name or password.", name=name,
                                   demo=app.data.demo and auth.DEMO_USER[0] in app.users, demo_user=auth.DEMO_USER), 401
        throttle.ok("ip:" + ip, "user:" + name)
        session.clear()
        session.permanent = True
        session["user"] = name
        return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("overview"))

    @app.post("/logout")
    def logout():
        check_csrf()
        session.clear()
        return redirect(url_for("login"))

    # --- pages -------------------------------------------------------------------------------
    def page(template, **kw):
        return render_template(template, user=current(), demo=app.data.demo, **kw)

    @app.get("/")
    @login_required
    def overview():
        return page("overview.html")

    @app.get("/site/<site_id>")
    @login_required
    def site_page(site_id):
        if not SITE_ID.fullmatch(site_id) or not allowed(site_id):
            abort(404)
        s = app.data.site(site_id)
        if not s:
            abort(404)
        return page("site.html", site=s)

    # --- data for the pages ----------------------------------------------------------------------
    @app.get("/api/sites")
    @login_required
    def api_sites():
        rows = [s for s in app.data.sites() if allowed(s["id"])]
        return jsonify({"sites": rows, "date": today().isoformat(), "demo": app.data.demo})

    def site_or_404(site_id):
        if not SITE_ID.fullmatch(site_id) or not allowed(site_id):
            abort(404)
        return site_id

    @app.get("/api/sites/<site_id>/trips")
    @login_required
    def api_trips(site_id):
        site_or_404(site_id)
        try:
            day = dt.date.fromisoformat(request.args.get("date") or today().isoformat())
        except ValueError:
            abort(400)
        return jsonify({"date": day.isoformat(), "trips": app.data.trips(site_id, day, day)})

    def day_arg():
        try:
            return dt.date.fromisoformat(request.args.get("date") or today().isoformat())
        except ValueError:
            abort(400)

    @app.get("/api/sites/<site_id>/day")
    @login_required
    def api_day(site_id):
        """Hourly trips, shifts, waste and material breakdowns, top vehicles and pending trips of one day."""
        site_or_404(site_id)
        day = day_arg()
        return jsonify({"date": day.isoformat(), **day_report(app.data.trips(site_id, day, day))})

    @app.get("/api/sites/<site_id>/trips.csv")
    @login_required
    def api_trips_csv(site_id):
        site_or_404(site_id)
        day = day_arg()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Date", "Time", "Ticket", "In/Out", "Vehicle", "Waste / material", "From / going to",
                    "Gross kg", "Tare kg", "Net kg", "Status", "Operator"])
        def cell(v):  # text starting with = + - @ would run as a formula in Excel
            return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v
        for t in reversed(app.data.trips(site_id, day, day)):
            w.writerow([cell(x) for x in (t["time"][:10], t["time"][11:16], t["id"],
                                          "Inward" if t["dir"] == "in" else "Outward", t["vno"], t["what"], t["where"],
                                          t["gross_kg"], t["tare_kg"], t["net_kg"],
                                          "Complete" if t["net_kg"] is not None else "Tare pending", t["operator"])])
        name = "%s-trips-%s.csv" % (site_id, day.isoformat())
        return Response("\ufeff" + buf.getvalue(), mimetype="text/csv",  # BOM so Excel reads it as UTF-8
                        headers={"Content-Disposition": 'attachment; filename="%s"' % name})

    @app.get("/api/sites/<site_id>/daily")
    @login_required
    def api_daily(site_id):
        site_or_404(site_id)
        return jsonify({"days": app.data.daily(site_id, 14)})

    @app.get("/api/sites/<site_id>/live")
    @login_required
    def api_live(site_id):
        site_or_404(site_id)
        return jsonify(app.data.live_state(site_id) or {"plant_online": False, "cams": [], "weight": None})

    @app.get("/cam/<site_id>/<cam>.mjpg")
    @login_required
    def camera(site_id, cam):
        """Live camera, passed through from the ISWM relay (which asks the plant for pictures only while
        someone watches). The ISWM API key stays on this server."""
        site_or_404(site_id)
        if not CAM_ID.fullmatch(cam):
            abort(404)
        q = request.args.get("q") if request.args.get("q") in ("low", "normal", "high") else "normal"
        stream = app.data.camera(site_id, cam, q)
        if stream is None:
            abort(404)
        return Response(stream, mimetype="multipart/x-mixed-replace; boundary=frame",
                        headers={"X-Accel-Buffering": "no"})

    @app.get("/healthz")
    def health():
        return "ok"

    return app


if __name__ == "__main__":
    os.environ.setdefault("COOKIE_SECURE", "0")  # plain http on this PC
    create_app().run(host="127.0.0.1", port=int(os.environ.get("PORT", 8080)), threaded=True)

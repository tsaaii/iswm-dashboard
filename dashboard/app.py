"""ISWM dashboard, built to the "ISWM Dashboard" design.

Screens:
  /         public landing: Live ULBs (trips and tonnes per day, trips per hour) and Upcoming ULBs
  /login    sign in
  /app      after sign in: Overview, Sites, Cameras, Reports, limited to the user's ULBs

Run locally:   python -m dashboard.app        then open http://127.0.0.1:8080
Settings (environment variables):
    ISWM_API_URL     address of the ISWM shared API on Cloud Run (empty = demo data)
    ISWM_API_KEY     an API key that cloud_api accepts (API_KEYS there)
    DASHBOARD_USERS  who may sign in, and what each sees (see auth.py)
    SECRET_KEY       long random text that signs the login cookie
    SITE_MAP         only if a plant's site id isn't "iswm-<ulb>": "nellore=my-id,badvel=..."
    CAMERA_LINKS     optional fixed camera links (see links.py); admins can also add them on the Cameras tab
"""
import datetime as dt
import os
import re
import secrets
from functools import wraps

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for

from .links import LinkError, Links

from . import auth, registry
from .data import ApiData, Cache, DemoData, today

CAM_ID = re.compile(r"front|back|cam[3-9]")
MAX_DAYS = 400


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
    public_cache = Cache()
    app.links = Links(os.environ.get("CAMERA_LINKS", ""))

    def ops():
        """Plants in operation: the linked ones if any camera link is set, else the package sheet's."""
        return app.links.ulbs() or registry.OPS

    # --- who is signed in, and what they may see ----------------------------------------------------
    def current():
        name = session.get("user")
        return name if name in app.users else None

    def scope():
        return registry.parse_scope(app.users[current()]["scope"])

    def my_ulbs():
        sc, linked = scope(), app.links.ulbs()
        out = [u for u in registry.ULBS if registry.in_scope(sc, u) and (not linked or u["id"] in linked)]
        return [dict(u, status="op") if u["id"] in linked else u for u in out]

    def my_ops():
        o = ops()
        return [u["id"] for u in my_ulbs() if u["id"] in o]

    def can_configure():
        return current() is not None and scope()["kind"] == "all"

    def login_required(fn):
        @wraps(fn)
        def wrap(*a, **k):
            if not current():
                if request.path.startswith(("/api/", "/cam/")):
                    abort(401)
                return redirect(url_for("login"))
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
        # the design is drawn with inline styles; scripts stay limited to this site's own files
        r.headers.setdefault("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; "
                                                        "style-src 'self' 'unsafe-inline'; script-src 'self'")
        if request.path.startswith(("/api/", "/cam/")):
            r.headers["Cache-Control"] = "no-store"
        return r

    def day_arg(name, default=None):
        try:
            return dt.date.fromisoformat(request.args.get(name) or (default or today()).isoformat())
        except ValueError:
            abort(400)

    # --- public landing ----------------------------------------------------------------------------
    @app.get("/")
    def landing():
        return render_template("landing.html", demo=app.data.demo)

    @app.get("/api/public/live")
    def public_live():
        """Totals for the landing page: trips, tonnes and trips per hour. No vehicle numbers or tickets."""
        day = min(day_arg("day"), today())
        ulb = request.args.get("ulb", "ALL")
        o = ops()
        ids = o if ulb not in o else [ulb]

        def make():
            ins = [t for t in app.data.trips(ids, day, day) if t["dir"] == "IN"]
            hours = [0] * 24
            for t in ins:
                hours[t["min"] // 60] += 1
            last = max((t["min"] for t in ins), default=None) if day == today() else None
            return {"day": day.isoformat(), "today": today().isoformat(), "trips": len(ins),
                    "kg": sum(t["net"] for t in ins if t["net"] is not None), "hours": hours, "last_min": last}
        out = public_cache.get(("live", day, ulb, tuple(o)), 30, make)
        return jsonify({**out, "ops": [registry.BY_ID[i] for i in o], "total_ulbs": len(registry.ULBS),
                        "op_start": registry.OP_START, "demo": app.data.demo})

    @app.get("/api/public/upcoming")
    def public_upcoming():
        return jsonify({"ulbs": registry.ULBS, "packages": [{k: p[k] for k in ("n", "ag", "dy", "tpd", "ulb")}
                                                            for p in registry.PACKAGES],
                        "awarded_tpd": registry.AWARDED_TPD})

    # --- sign in -----------------------------------------------------------------------------------
    @app.get("/login")
    def login():
        if current():
            return redirect(url_for("app_page"))
        return render_template("login.html", demo=app.data.demo and auth.DEMO_USER[0] in app.users,
                               demo_user=auth.DEMO_USER, no_users=not app.users)

    @app.post("/login")
    def login_post():
        check_csrf()
        name = request.form.get("name", "").strip()
        pw = request.form.get("password", "")
        ip = request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip()
        demo = app.data.demo and auth.DEMO_USER[0] in app.users
        if throttle.blocked("ip:" + ip, "user:" + name):
            return render_template("login.html", error="Too many tries. Wait a minute.", name=name, demo=demo,
                                   demo_user=auth.DEMO_USER), 429
        user = app.users.get(name) or app.users.get(name.lower())
        if not user or not auth.check_password(pw, user["hash"]):
            throttle.failed("ip:" + ip, "user:" + name)
            return render_template("login.html", error="Username or password is incorrect.", name=name, demo=demo,
                                   demo_user=auth.DEMO_USER), 401
        throttle.ok("ip:" + ip, "user:" + name)
        session.clear()
        session.permanent = True
        session["user"] = name if name in app.users else name.lower()
        return redirect(url_for("app_page"))

    @app.post("/logout")
    def logout():
        check_csrf()
        session.clear()
        return redirect(url_for("landing"))

    # --- after sign in ---------------------------------------------------------------------------------
    @app.get("/app")
    @login_required
    def app_page():
        return render_template("app.html", demo=app.data.demo)

    @app.get("/api/me")
    @login_required
    def api_me():
        u = app.users[current()]
        access, label = registry.describe(scope())
        return jsonify({"user": current(), "who": u["who"], "access": access, "scope": label, "ulbs": my_ulbs(),
                        "ops": my_ops(), "today": today().isoformat(), "op_start": registry.OP_START,
                        "demo": app.data.demo, "can_configure": can_configure(), "linked": bool(app.links.ulbs())})

    def ids_arg():
        ops = my_ops()
        want = [x for x in (request.args.get("ids") or "").split(",") if x]
        return [x for x in want if x in ops] if want else ops

    @app.get("/api/trips")
    @login_required
    def api_trips():
        d0, d1 = day_arg("from"), min(day_arg("to"), today())
        if d0 > d1 or (d1 - d0).days > MAX_DAYS:
            abort(400, "Pick at most %d days." % MAX_DAYS)
        return jsonify({"from": d0.isoformat(), "to": d1.isoformat(), "trips": app.data.trips(ids_arg(), d0, d1)})

    @app.get("/api/sync")
    @login_required
    def api_sync():
        return jsonify(app.data.sync_minutes(ids_arg()))

    @app.get("/api/cams/<ulb>")
    @login_required
    def api_cams(ulb):
        if ulb not in my_ops():
            abort(404)
        if app.links.get(ulb):
            return jsonify({"cams": app.links.cameras(ulb), "linked": True, "online": app.links.online(ulb)})
        return jsonify({"cams": app.data.cameras(ulb), "linked": False})

    # camera links (Configure cameras): only for All-sites logins -------------------------------
    def check_api_csrf():
        sent, want = request.headers.get("X-CSRF", ""), session.get("csrf", "")
        if not want or not secrets.compare_digest(sent, want):
            abort(400, "Reload the page and try again.")

    @app.get("/api/links")
    @login_required
    def api_links():
        if not can_configure():
            abort(403)
        return jsonify({"links": app.links.public(), "ulbs": [{"id": u["id"], "name": u["name"], "pk": u["pk"]}
                                                              for u in registry.ULBS]})

    @app.post("/api/links")
    @login_required
    def api_links_add():
        if not can_configure():
            abort(403)
        check_api_csrf()
        body = request.get_json(silent=True) or {}
        try:
            ulb = app.links.add(body.get("link", ""), body.get("ulb") or None)
        except LinkError as e:
            return jsonify({"error": str(e)}), 400
        public_cache._d.clear()
        return jsonify({"ulb": ulb, "links": app.links.public()})

    @app.delete("/api/links/<ulb>")
    @login_required
    def api_links_remove(ulb):
        if not can_configure():
            abort(403)
        check_api_csrf()
        app.links.remove(ulb)
        public_cache._d.clear()
        return jsonify({"links": app.links.public()})

    @app.get("/cam/<ulb>/<cam>.mjpg")
    @login_required
    def camera(ulb, cam):
        """Live camera, passed through from the ISWM relay (which asks the plant for pictures only while
        someone watches). The ISWM API key stays on this server."""
        if ulb not in my_ops() or not CAM_ID.fullmatch(cam):
            abort(404)
        q = request.args.get("q") if request.args.get("q") in ("low", "normal", "high") else "normal"
        stream = app.links.camera(ulb, cam, q) if app.links.get(ulb) else app.data.camera(ulb, cam, q)
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

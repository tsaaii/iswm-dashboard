"""ISWM dashboard: every plant on one screen, with login, totals, trips and live cameras.

Run locally:   python -m dashboard.app        then open http://127.0.0.1:8080
Settings (environment variables):
    ISWM_API_URL     address of the ISWM shared API on Cloud Run (empty = demo data)
    ISWM_API_KEY     an API key that cloud_api accepts (API_KEYS there)
    DASHBOARD_USERS  who may log in (see auth.py)
    SECRET_KEY       long random text that signs the login cookie
"""
import datetime as dt
import os
import re
import secrets
from functools import wraps

from flask import (Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for)

from . import auth
from .data import ApiData, DemoData, today

SITE_ID = re.compile(r"[a-z0-9-]{1,60}")
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

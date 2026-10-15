"""Where the dashboard gets its numbers and pictures.

Two sources with the same methods:

* DemoData  - made-up sites, trips and moving camera pictures. Used when no
              ISWM API address is set, so the dashboard can be tried at once.
* ApiData   - the real ISWM shared API on Cloud Run (the repo tsaaii/ISWM,
              folder cloud_api). Records come from Firestore through it, and the
              camera pictures come through its relay from the plant PC.

The browser never talks to the ISWM API itself: the API key stays on this server.
"""
import datetime as dt
import hashlib
import io
import random
import threading
import time

TZ = dt.timezone(dt.timedelta(minutes=330))  # India


def today():
    return dt.datetime.now(TZ).date()


def _rng(*parts):
    return random.Random(int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16))


class Cache:
    """Small time-limited cache, so many people looking at the dashboard don't multiply API (and Firestore) reads."""

    def __init__(self):
        self._d, self._lock = {}, threading.Lock()

    def get(self, key, seconds, make):
        now = time.monotonic()
        with self._lock:
            hit = self._d.get(key)
            if hit and now - hit[0] < seconds:
                return hit[1]
        value = make()
        with self._lock:
            self._d[key] = (now, value)
        return value


# --- demo -----------------------------------------------------------------------------------

DEMO_SITES = [
    ("iswm-donthali", "ISWM Donthali", "Lions Group", ["Front cam", "Back cam", "Tipping floor", "Windrow yard"]),
    ("iswm-kadiri", "ISWM Kadiri", "Lions Group", ["Front cam", "Back cam", "Tipping floor"]),
    ("iswm-guntur", "ISWM Guntur", "Tharuni Associates", ["Front cam", "Back cam", "Windrow yard", "RDF shed"]),
    ("iswm-nellore", "ISWM Nellore", "Tharuni Associates", ["Front cam", "Back cam"]),
    ("iswm-ongole", "ISWM Ongole", "Lions Group", ["Front cam", "Back cam", "Tipping floor"]),
    ("iswm-tirupati", "ISWM Tirupati", "Tharuni Associates", ["Front cam", "Back cam", "Tipping floor", "Compost yard"]),
    ("iswm-kurnool", "ISWM Kurnool", "Lions Group", ["Front cam", "Back cam"]),
    ("iswm-anantapur", "ISWM Anantapur", "Lions Group", ["Front cam", "Back cam", "Tipping floor"]),
]
OFFLINE = {"iswm-kurnool"}  # one site shown offline, as happens in real life
# and a couple with problems, so the status board has something to show
DEMO_TROUBLE = {"iswm-guntur": {"wb": False}, "iswm-tirupati": {"cam_problems": ["Compost yard"]}}
IN_TYPES = ["Mixed", "Mixed", "Mixed", "Wet", "Dry"]
SOURCES = ["Residential", "Residential", "Commercial"]
MATERIALS = [("Compost", "Farmer buyer"), ("RDF bales", "Ultratech cement"), ("Recyclables", "Sri Sai traders"),
             ("Disposal", "Landfill cell 2")]


def _cam_ids(names):
    ids = ["front", "back"] + ["cam%d" % i for i in range(3, 9)]
    return [[ids[i], n] for i, n in enumerate(names)]


class DemoData:
    demo = True

    def __init__(self):
        self.sites_by_id = {s[0]: s for s in DEMO_SITES}

    def _vehicles(self, site):
        r = _rng(site, "fleet")
        return ["AP %02d %s %04d" % (r.choice([3, 21, 26, 39, 2]), r.choice(["TA", "TB", "UA", "Z", "TC"]), r.randint(1000, 9999))
                for _ in range(14)]

    def trips(self, site, day_from, day_to):
        """Every trip between two dates (newest first), made up but the same every time for a date."""
        if site not in self.sites_by_id:
            return []
        fleet = self._vehicles(site)
        out, d = [], day_from
        now = dt.datetime.now(TZ)
        while d <= day_to:
            r = _rng(site, d.isoformat())
            n_in = r.randint(28, 46) if d.weekday() != 6 else r.randint(12, 20)
            seq_in = seq_out = 0
            for i in range(n_in + r.randint(4, 9)):
                t = dt.datetime.combine(d, dt.time(6, 0), TZ) + dt.timedelta(minutes=r.randint(0, 15 * 60))
                if t > now:
                    continue
                vno = r.choice(fleet)
                if i < n_in:
                    seq_in += 1
                    src = r.choice(SOURCES)
                    tare = r.randint(55, 90) * 100
                    net = r.randint(18, 75) * 100
                    pending = d == today() and now - t < dt.timedelta(minutes=40) and r.random() < 0.6
                    out.append({"id": "IN%s%s%04d" % ("C" if src == "Commercial" else "R", d.strftime("%y%m"), seq_in),
                                "dir": "in", "vno": vno, "time": t.isoformat(timespec="minutes"),
                                "what": r.choice(IN_TYPES), "where": src, "gross_kg": tare + net,
                                "tare_kg": None if pending else tare, "net_kg": None if pending else net,
                                "operator": r.choice(["Ramesh K.", "Lakshmi P.", "Suresh B."])})
                else:
                    seq_out += 1
                    mat, dest = r.choice(MATERIALS)
                    tare = r.randint(55, 90) * 100
                    net = r.randint(20, 90) * 100
                    out.append({"id": "O%s%04d" % (d.strftime("%y%m"), seq_out), "dir": "out", "vno": vno,
                                "time": t.isoformat(timespec="minutes"), "what": mat, "where": dest,
                                "gross_kg": tare + net, "tare_kg": tare, "net_kg": net,
                                "operator": r.choice(["Ramesh K.", "Lakshmi P.", "Suresh B."])})
            d += dt.timedelta(days=1)
        out.sort(key=lambda x: x["time"], reverse=True)
        return out

    def _totals(self, rows):
        done = [x for x in rows if x["net_kg"] is not None]
        hours = {"in": [0] * 24, "out": [0] * 24}
        for x in rows:
            hours[x["dir"]][int(x["time"][11:13])] += 1
        return {"in_by_hour": hours["in"], "out_by_hour": hours["out"],"in_trips": sum(1 for x in done if x["dir"] == "in"),
                "in_kg": sum(x["net_kg"] for x in done if x["dir"] == "in"),
                "out_trips": sum(1 for x in done if x["dir"] == "out"),
                "out_kg": sum(x["net_kg"] for x in done if x["dir"] == "out"),
                "pending": sum(1 for x in rows if x["net_kg"] is None)}

    def sites(self):
        out, now = [], dt.datetime.now(TZ)
        for sid, name, company, cams in DEMO_SITES:
            r = _rng(sid, now.strftime("%Y%m%d%H"))
            offline = sid in OFFLINE
            last = now - (dt.timedelta(hours=5, minutes=r.randint(0, 50)) if offline else dt.timedelta(minutes=r.randint(1, 10)))
            status = None if offline else {"ver": "1.5.0", "wb": True, "kg": 0, "stable": True, "cams": len(cams),
                                           "cam_problems": [], "queued": r.randint(0, 6), "sync": "synced",
                                           "operator": r.choice(["Ramesh K.", "Lakshmi P.", "Suresh B."]),
                                           **DEMO_TROUBLE.get(sid, {})}
            seen = None if offline else now - dt.timedelta(seconds=r.randint(2, 25))
            out.append({"id": sid, "name": name, "company": company, "online": not offline,
                        "last_sync": last.isoformat(timespec="minutes"), "cameras": _cam_ids(cams),
                        "today": {"date": today().isoformat(), **self._totals(self.trips(sid, today(), today()))},
                        "health": health(not offline, seen or last, status)})
        return out

    def site(self, sid):
        return next((s for s in self.sites() if s["id"] == sid), None)

    def daily(self, sid, days=14):
        out = []
        for i in range(days - 1, -1, -1):
            d = today() - dt.timedelta(days=i)
            out.append({"date": d.isoformat(), **self._totals(self.trips(sid, d, d))})
        return out

    def live_state(self, sid):
        s = self.sites_by_id.get(sid)
        if not s:
            return None
        online = sid not in OFFLINE
        w = int(7200 + 1800 * __import__("math").sin(time.time() / 9)) // 10 * 10
        return {"plant_online": online, "cams": _cam_ids(s[3]),
                "weight": {"connected": online, "weight": w, "stable": int(time.time()) % 6 < 4} if online else None}

    def camera(self, sid, cam, quality):
        """Endless moving test pictures, as an MJPEG stream. Nothing real; only to see the layout."""
        s = self.sites_by_id.get(sid)
        names = dict(_cam_ids(s[3])) if s else {}
        if cam not in names or sid in OFFLINE:
            return None
        width = {"low": 480, "normal": 640, "high": 960}.get(quality, 640)

        def gen():
            end = time.monotonic() + 600
            while time.monotonic() < end:
                jpg = _demo_frame(s[1], names[cam], width)
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + \
                    b"\r\n\r\n" + jpg + b"\r\n"
                time.sleep(0.5)
        return gen()


def _demo_frame(site, label, width):
    from PIL import Image, ImageDraw
    h = width * 9 // 16
    img = Image.new("RGB", (width, h), (86, 110, 80))
    d = ImageDraw.Draw(img)
    d.rectangle([0, h * 2 // 3, width, h], fill=(120, 120, 112))  # road
    x = int((time.time() * 60) % (width + 200)) - 200
    d.rectangle([x, h * 2 // 3 - 70, x + 150, h * 2 // 3 - 10], fill=(27, 138, 58))  # truck body
    d.rectangle([x + 150, h * 2 // 3 - 50, x + 190, h * 2 // 3 - 10], fill=(242, 194, 0))  # cab
    for cx in (x + 30, x + 120, x + 170):
        d.ellipse([cx - 12, h * 2 // 3 - 22, cx + 12, h * 2 // 3 + 2], fill=(21, 21, 21))
    d.rectangle([0, 0, width, 26], fill=(18, 26, 20))
    d.text((10, 7), "DEMO  %s - %s  %s" % (site, label, dt.datetime.now(TZ).strftime("%d-%m-%Y %H:%M:%S")),
           fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


# --- real ISWM API ------------------------------------------------------------------------------

class ApiData:
    """Reads the ISWM shared API (cloud_api). Needs its address and an API key made for the dashboard."""
    demo = False

    def __init__(self, url, key):
        import requests
        self.url, self.key = url.rstrip("/"), key
        self.http = requests.Session()
        self.http.headers["X-API-Key"] = key
        self.cache = Cache()

    def _get(self, path, **params):
        r = self.http.get(self.url + path, params=params, timeout=20)
        r.raise_for_status()
        return r.json()

    def relay_status(self):
        """Every plant's live check-in from the relay (one call; the relay keeps it in memory)."""
        def load():
            try:
                return self._get("/v1/live/status")
            except Exception:
                return {}  # older relay, or relay down: fall back to sync times
        return self.cache.get("relay-status", 15, load)

    def sites(self):
        live = self.relay_status()
        now = dt.datetime.now(TZ)
        out = []
        for s in self._sites():
            lv = live.get(s["id"])
            synced = s["online"]
            if lv:  # the relay hears from a plant every ~20 s: better than sync time, which waits for new records
                seen = now - dt.timedelta(seconds=lv.get("seen_s") or 0)
                s = dict(s, online=bool(lv.get("online")), health=health(bool(lv.get("online")), seen, lv.get("status")))
                if lv.get("cams") and not s["cameras"]:
                    s["cameras"] = lv["cams"]
            else:
                s = dict(s, health=health(synced, _parse_time(s["last_sync"]), None))
            out.append(s)
        return out

    def _sites(self):
        def load():
            now = dt.datetime.now(TZ)
            out = []
            for s in self._get("/v1/sites"):
                last = _parse_time(s.get("last_sync"))
                t = s.get("today") or {}
                if t.get("date") != today().isoformat():
                    t = {}  # yesterday's totals: nothing synced yet today
                out.append({"id": s["id"], "name": s.get("name") or s["id"], "company": s.get("company") or "",
                            # a plant syncs every few minutes while it has new records; quiet for 2 hours = offline
                            "online": bool(last and now - last < dt.timedelta(hours=2)),
                            "last_sync": last.isoformat(timespec="minutes") if last else None,
                            "cameras": [[c.get("id"), c.get("name")] for c in (s.get("cameras") or []) if c.get("id")],
                            "today": {"in_trips": t.get("in_trips", 0), "in_kg": t.get("in_kg", 0),
                                      "out_trips": t.get("out_trips", 0), "out_kg": t.get("out_kg", 0),
                                      "pending": t.get("pending", 0),
                                      "in_by_hour": t.get("in_by_hour") or [0] * 24,
                                      "out_by_hour": t.get("out_by_hour") or [0] * 24}})
            return sorted(out, key=lambda x: x["name"])
        return self.cache.get("sites", 60, load)

    def site(self, sid):
        return next((s for s in self.sites() if s["id"] == sid), None)

    def trips(self, sid, day_from, day_to):
        def load():
            rows = self._get("/v1/sites/%s/entries" % sid, **{"from": day_from.isoformat(), "to": day_to.isoformat(),
                                                             "limit": 2000})
            return [{"id": r.get("id"), "dir": r.get("dir"), "vno": r.get("vno"),
                     "time": (r.get("created_at") or "")[:16],
                     "what": r.get("waste_type") if r.get("dir") == "in" else r.get("material"),
                     "where": r.get("source") if r.get("dir") == "in" else r.get("dest"),
                     "gross_kg": r.get("gross_kg"), "tare_kg": r.get("tare_kg"), "net_kg": r.get("net_kg"),
                     "operator": r.get("operator")} for r in rows]
        return self.cache.get(("trips", sid, day_from, day_to), 120, load)

    def daily(self, sid, days=14):
        start = today() - dt.timedelta(days=days - 1)
        rows = self.trips(sid, start, today())
        by = {(start + dt.timedelta(days=i)).isoformat(): {"in_trips": 0, "in_kg": 0, "out_trips": 0, "out_kg": 0,
                                                            "pending": 0} for i in range(days)}
        for r in rows:
            b = by.get(r["time"][:10])
            if b is None:
                continue
            if r["net_kg"] is None:
                b["pending"] += 1
            else:
                b[r["dir"] + "_trips"] += 1
                b[r["dir"] + "_kg"] += r["net_kg"]
        return [{"date": d, **v} for d, v in by.items()]

    def live_state(self, sid):
        try:
            s = self._get("/v1/sites/%s/live/state" % sid)
        except Exception:
            return None
        return {"plant_online": s.get("plant_online"), "cams": s.get("cams") or [], "weight": s.get("weight")}

    def camera(self, sid, cam, quality):
        """Pass the relay's MJPEG stream through. While this is open, the relay asks the plant for pictures."""
        r = self.http.get(self.url + "/v1/sites/%s/live/%s.mjpg" % (sid, cam), params={"q": quality},
                          stream=True, timeout=(10, 60))
        if r.status_code != 200:
            r.close()
            return None

        def gen():
            try:
                for chunk in r.iter_content(16384):
                    yield chunk
            finally:
                r.close()
        return gen()


def health(online, seen, status):
    """A plant's state for the status board: ok, attention (online but something is wrong) or offline,
    with the reasons in plain words."""
    st = status or {}
    reasons = []
    if online and status:
        if not st.get("wb", True):
            reasons.append("Weighbridge not connected")
        for name in st.get("cam_problems") or []:
            reasons.append("Camera problem: %s" % name)
        if st.get("sync") == "error":
            reasons.append("Cloud sync error")
        if (st.get("queued") or 0) > 100:
            reasons.append("%d records waiting to sync" % st["queued"])
    state = "offline" if not online else "attention" if reasons else "ok"
    if not online:
        reasons = ["No contact since %s" % seen.strftime("%d %b %H:%M") if seen else "Never connected"]
    return {"state": state, "reasons": reasons, "seen": seen.isoformat(timespec="seconds") if seen else None,
            "wb": st.get("wb") if status else None, "kg": st.get("kg"), "cams": st.get("cams"),
            "cam_problems": st.get("cam_problems") or [], "queued": st.get("queued"), "sync": st.get("sync"),
            "version": st.get("ver"), "operator": st.get("operator")}


def _parse_time(v):
    if not v:
        return None
    try:
        t = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=TZ)

"""Where the dashboard gets its trips, sync times and camera pictures.

* DemoData - made-up trips for the operational ULBs (same rules as the design prototype), and
             moving test pictures. Used when no ISWM API address is set.
* ApiData  - the real ISWM shared API on Cloud Run (repo tsaaii/ISWM, folder cloud_api): trips
             from Firestore, sync times, and camera pictures through its relay.

A trip, as the pages use it:
    {site, date "YYYY-MM-DD", min (minute of the day), veh, dir "IN"|"OUT", mat, gross, tare, net, dest, ticket}
tare and net are None while the empty weight is pending.
The browser never talks to the ISWM API itself: the API key stays on this server.
"""
import datetime as dt
import hashlib
import io
import os
import random
import threading
import time

from .registry import BY_ID, OP_START, OPS, SITE_IDS

TZ = dt.timezone(dt.timedelta(minutes=330))  # India


def today():
    return dt.datetime.now(TZ).date()


def days(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


class Cache:
    """Small time-limited cache, so many viewers don't multiply API (and Firestore) reads."""

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


def _rng(*parts):
    return random.Random(int(hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:12], 16))


# --- demo -------------------------------------------------------------------------------------

PROFILE = [.2, .1, .1, .1, .3, 1, 2.2, 3, 3.2, 2.8, 2.2, 1.6, 1.2, 1, 1.2, 1.8, 2, 1.6, 1, .6, .4, .3, .2, .2]
DEST = {"RDF": "Cement plant · RDF co-processing", "Compost": "Compost buyers · farmer groups",
        "Recyclables": "Authorised recyclers", "Inerts": "Sanitary landfill"}
NET_OUT = {"RDF": (6, 12), "Compost": (3, 8), "Recyclables": (2, 6), "Inerts": (6, 10)}
DEMO_CAMS = ["Weighbridge · entry", "Weighbridge · exit", "Tipping floor", "Windrow yard"]


class DemoData:
    demo = True

    def _vehicles(self, sid):
        r = _rng("veh", sid)
        L = "ABCDEFGHJKLMNPRTUVWXZ"
        st = "%02d" % (10 + int(hashlib.md5(sid.encode()).hexdigest(), 16) % 30)
        return ["AP %s %s%s %d" % (st, r.choice(L), r.choice(L), r.randint(1000, 9999)) for _ in range(10)]

    def _day(self, sid, d):
        ds = d.isoformat()
        if ds < OP_START or sid not in BY_ID:
            return []
        now = dt.datetime.now(TZ)
        cutoff = now.hour * 60 + now.minute if d == now.date() else 1440
        r, u, V = _rng(sid, ds), BY_ID[sid], self._vehicles(sid)
        out = []

        def minute():
            x = r.random() * sum(PROFILE)
            for h, p in enumerate(PROFILE):
                x -= p
                if x <= 0:
                    return h * 60 + r.randint(0, 59)
            return 23 * 60
        n_in = max(4, round(u["cap"] * (.8 + .35 * r.random()) / 3.2))
        for _ in range(n_in):
            m, veh = minute(), r.choice(V)
            net, tare = round(1.8 + r.random() * 3.4, 2) * 1000, round((4200 + r.random() * 3400) / 10) * 10
            x, q = r.random(), r.random()
            mat = "Mixed" if x < .55 else "Wet" if x < .85 else "Dry"
            if m > cutoff:
                continue
            inc = (cutoff - m < 30 and q < .6) if cutoff < 1440 else q < .012
            out.append({"site": sid, "date": ds, "min": m, "veh": veh, "dir": "IN", "mat": mat, "gross": tare + net,
                        "tare": None if inc else tare, "net": None if inc else net, "dest": ""})
        for _ in range(max(1, round(n_in * .18))):
            m, x = 330 + r.randint(0, 869), r.random()
            mat = "RDF" if x < .35 else "Compost" if x < .55 else "Recyclables" if x < .8 else "Inerts"
            a, b = NET_OUT[mat]
            net, tare, veh, q = round(a + r.random() * (b - a), 2) * 1000, round((6500 + r.random() * 3000) / 10) * 10, \
                r.choice(V), r.random()
            if m > cutoff:
                continue
            inc = (cutoff - m < 30 and q < .5) if cutoff < 1440 else q < .01
            out.append({"site": sid, "date": ds, "min": m, "veh": veh, "dir": "OUT", "mat": mat, "gross": tare + net,
                        "tare": None if inc else tare, "net": None if inc else net, "dest": DEST[mat]})
        out.sort(key=lambda t: t["min"])
        n = {"IN": 0, "OUT": 0}
        for t in out:
            n[t["dir"]] += 1
            t["ticket"] = ("INR" if t["dir"] == "IN" else "O") + d.strftime("%y%m%d") + "%02d" % n[t["dir"]]
        return out

    def trips(self, ids, day_from, day_to):
        out = []
        for d in days(day_from, min(day_to, today())):
            for sid in ids:
                out.extend(self._day(sid, d))
        return out

    def sync_minutes(self, ids):
        """Minutes since each plant last synced (one plant is behind, as happens in real life)."""
        return {sid: 140 if sid == "kamalapuram" else 1 + _rng("sy", sid).randint(0, 8) for sid in ids}

    def cameras(self, sid):
        return [["front", DEMO_CAMS[0]], ["back", DEMO_CAMS[1]], ["cam3", DEMO_CAMS[2]], ["cam4", DEMO_CAMS[3]]] \
            if sid in OPS else []

    def camera(self, sid, cam, quality):
        """Endless moving test pictures, as an MJPEG stream. Nothing real; only to see the layout."""
        names = dict(self.cameras(sid))
        if cam not in names:
            return None
        width = {"low": 480, "normal": 640, "high": 960}.get(quality, 640)

        def gen():
            end = time.monotonic() + 600
            while time.monotonic() < end:
                jpg = _demo_frame("ISWM " + BY_ID[sid]["name"], names[cam], width)
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + \
                    b"\r\n\r\n" + jpg + b"\r\n"
                time.sleep(0.5)
        return gen()


def _demo_frame(site, label, width):
    from PIL import Image, ImageDraw
    h = width * 9 // 16
    img = Image.new("RGB", (width, h), (86, 110, 80))
    d = ImageDraw.Draw(img)
    d.rectangle([0, h * 2 // 3, width, h], fill=(120, 120, 112))
    x = int((time.time() * 60) % (width + 200)) - 200
    d.rectangle([x, h * 2 // 3 - 70, x + 150, h * 2 // 3 - 10], fill=(15, 161, 78))
    d.rectangle([x + 150, h * 2 // 3 - 50, x + 190, h * 2 // 3 - 10], fill=(242, 194, 0))
    for cx in (x + 30, x + 120, x + 170):
        d.ellipse([cx - 12, h * 2 // 3 - 22, cx + 12, h * 2 // 3 + 2], fill=(21, 21, 21))
    d.rectangle([0, 0, width, 26], fill=(18, 26, 20))
    d.text((10, 7), "DEMO  %s - %s" % (site, label), fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=70)
    return buf.getvalue()


# --- real ISWM API ------------------------------------------------------------------------------

# the plant app's outward materials, grouped the way the dashboard reports them
OUT_GROUP = {"rdf bales": "RDF", "rdf": "RDF", "compost": "Compost", "recyclables": "Recyclables",
             "metal scrap": "Recyclables", "glass scrap": "Recyclables", "non recyclables": "Inerts",
             "disposal": "Inerts", "inerts": "Inerts"}


class ApiData:
    """Reads the ISWM shared API (cloud_api). Needs its address and an API key made for the dashboard.

    ULBs are matched to plant site ids by name: ULB "Nellore" is plant site "iswm-nellore" (the
    plant app's default) or "nellore". SITE_MAP="nellore=my-site-id,badvel=..." overrides that.
    """
    demo = False

    def __init__(self, url, key, site_map=None):
        import requests
        self.url, self.key = url.rstrip("/"), key
        self.http = requests.Session()
        self.http.headers["X-API-Key"] = key
        self.cache = Cache()
        self.site_map = dict(x.split("=", 1) for x in (site_map if site_map is not None
                                                        else os.environ.get("SITE_MAP", "")).split(",") if "=" in x)

    def _get(self, path, **params):
        r = self.http.get(self.url + path, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def _sites(self):
        def load():
            try:
                return {s["id"]: s for s in self._get("/v1/sites")}
            except Exception:  # cloud sync not set up yet: cameras can still come through the relay
                return {}
        return self.cache.get("sites", 60, load)

    def api_id(self, ulb):
        if ulb in self.site_map:
            return self.site_map[ulb]
        if ulb in SITE_IDS:
            return SITE_IDS[ulb]
        sites = self._sites()
        for cand in ("iswm-" + ulb, ulb):
            if cand in sites:
                return cand
        return None

    def _site_trips(self, ulb, d0, d1):
        sid = self.api_id(ulb)
        if not sid:
            return []

        def load():
            try:
                rows = self._get("/v1/sites/%s/entries" % sid, **{"from": d0.isoformat(), "to": d1.isoformat(),
                                                                 "limit": 5000})
            except Exception:  # no records in the cloud for this plant (yet)
                return []
            out = []
            for r in rows:
                t = _parse_time(r.get("created_at"))
                if not t:
                    continue
                t = t.astimezone(TZ)
                out_dir = r.get("dir") == "out"
                mat = OUT_GROUP.get(str(r.get("material") or "").lower(), "Inerts") if out_dir \
                    else (r.get("waste_type") or "Mixed")
                out.append({"site": ulb, "date": t.date().isoformat(), "min": t.hour * 60 + t.minute,
                            "veh": r.get("vno") or "", "dir": "OUT" if out_dir else "IN", "mat": mat,
                            "gross": r.get("gross_kg"), "tare": r.get("tare_kg"), "net": r.get("net_kg"),
                            "dest": (r.get("dest") or "") if out_dir else "", "ticket": r.get("id") or ""})
            return out
        # today's trips change; older days don't
        return self.cache.get(("trips", ulb, d0, d1), 120 if d1 >= today() else 1800, load)

    def trips(self, ids, day_from, day_to):
        out = []
        for ulb in ids:
            out.extend(self._site_trips(ulb, day_from, min(day_to, today())))
        return out

    def sync_minutes(self, ids):
        now = dt.datetime.now(TZ)
        out = {}
        for ulb in ids:
            s = self._sites().get(self.api_id(ulb) or "")
            t = _parse_time((s or {}).get("last_sync"))
            out[ulb] = int((now - t).total_seconds() // 60) if t else None
        return out

    def cameras(self, ulb):
        sid = self.api_id(ulb)
        if not sid:
            return []
        try:
            st = self.cache.get(("live", sid), 10, lambda: self._get("/v1/sites/%s/live/state" % sid))
        except Exception:
            st = {}
        names = st.get("cams") or [[c.get("id"), c.get("name")]
                                   for c in (self._sites().get(sid) or {}).get("cameras") or []]
        return [c for c in names if c and c[0]]

    def camera(self, ulb, cam, quality):
        """Pass the relay's MJPEG stream through. While this is open, the relay asks the plant for pictures."""
        sid = self.api_id(ulb)
        if not sid:
            return None
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


def _parse_time(v):
    if not v:
        return None
    try:
        t = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=TZ)

"""Camera links: a plant's live link from the ISWM relay, pasted into the dashboard.

    https://iswm-api-….run.app/live/iswm-ananthapur?key=VIEWER-KEY

Once at least one link is set, the dashboard shows only the linked plants, and their
cameras come live from the relay. The numbers stay as they are (demo data, or the
ISWM API when it is set).

Links are saved in dashboard_data/links.json (DASHBOARD_DATA sets the folder), and can
also be fixed with CAMERA_LINKS="anantapur=https://…/live/iswm-ananthapur?key=…;…".
The viewer key stays on this server; pages only see it masked.
"""
import difflib
import json
import os
import re
import threading
import urllib.parse

from .registry import BY_ID, SITE_IDS

SITE = re.compile(r"[a-z0-9-]{1,60}")


class LinkError(ValueError):
    pass


def parse(link):
    """(relay base URL, site id, key) from a /live/<site>?key=… link."""
    u = urllib.parse.urlsplit((link or "").strip())
    m = re.fullmatch(r"/live/([^/]+)/?", u.path or "")
    key = (urllib.parse.parse_qs(u.query).get("key") or [""])[0]
    local = u.hostname in ("127.0.0.1", "localhost")
    if u.scheme not in ("https", "http") or (u.scheme == "http" and not local) or not u.netloc or not m:
        raise LinkError("Paste the plant's live link, like https://iswm-api-….run.app/live/iswm-ananthapur?key=…")
    site = m.group(1).lower()
    if not SITE.fullmatch(site):
        raise LinkError("The plant name in the link should be like iswm-ananthapur.")
    if not key:
        raise LinkError("The link needs its ?key=… part.")
    return "%s://%s" % (u.scheme, u.netloc), site, key


def guess_ulb(site):
    """Which of the 107 ULBs a plant site id is, e.g. iswm-ananthapur -> anantapur."""
    for ulb, sid in SITE_IDS.items():
        if sid == site:
            return ulb
    name = site[5:] if site.startswith("iswm-") else site
    if name in BY_ID:
        return name
    near = difflib.get_close_matches(name, list(BY_ID), n=1, cutoff=0.8)
    return near[0] if near else None


class Links:
    def __init__(self, fixed="", folder=None):
        self.folder = folder or os.environ.get("DASHBOARD_DATA") or os.path.join(os.getcwd(), "dashboard_data")
        self.path = os.path.join(self.folder, "links.json")
        self._lock = threading.Lock()
        self._state = {}
        self.fixed = {}
        for item in filter(None, (fixed or "").split(";")):
            ulb, _, link = item.partition("=")
            if ulb.strip() in BY_ID:
                base, site, key = parse(link)
                self.fixed[ulb.strip()] = {"base": base, "site": site, "key": key}
        self.saved = self._load()

    def _load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            return {k: v for k, v in data.items() if k in BY_ID}
        except (OSError, ValueError):
            return {}

    def _save(self):
        os.makedirs(self.folder, exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.saved, f, indent=1)
        os.replace(tmp, self.path)

    def all(self):
        return {**self.saved, **self.fixed}

    def get(self, ulb):
        return self.all().get(ulb)

    def ulbs(self):
        return [u for u in BY_ID if u in self.all()]  # in package order

    def add(self, link, ulb=None):
        base, site, key = parse(link)
        ulb = ulb or guess_ulb(site)
        if ulb not in BY_ID:
            raise LinkError("Couldn't tell which ULB %s is. Pick it from the list." % site)
        with self._lock:
            self.saved[ulb] = {"base": base, "site": site, "key": key}
            self._save()
        return ulb

    def remove(self, ulb):
        with self._lock:
            self.saved.pop(ulb, None)
            self._save()

    def public(self):
        """For the settings panel: no full keys."""
        out = []
        for ulb, l in self.all().items():
            k = l["key"]
            out.append({"ulb": ulb, "name": BY_ID[ulb]["name"], "site": l["site"], "fixed": ulb in self.fixed,
                        "link": "%s/live/%s?key=%s" % (l["base"], l["site"], (k[:3] + "•••" + k[-2:]) if len(k) > 6 else "•••")})
        return out

    # cameras through the relay ----------------------------------------------------------------
    def _get(self, l, path, **kw):
        import requests
        return requests.get(l["base"] + path, headers={"X-API-Key": l["key"]}, **kw)

    def state(self, ulb):
        """{"cams": [[id, name], …], "online": bool, "error": text or None}, from the relay, kept 10 s."""
        import time
        hit = self._state.get(ulb)
        if hit and time.monotonic() - hit[0] < 10:
            return hit[1]
        l = self.get(ulb)
        try:
            r = self._get(l, "/v1/sites/%s/live/state" % l["site"], timeout=8)
            if r.status_code == 401:
                out = {"cams": [], "online": False, "error": "The relay refused the key in the link."}
            elif r.status_code != 200:
                out = {"cams": [], "online": False, "error": "The relay doesn't know %s." % l["site"]}
            else:
                d = r.json()
                out = {"cams": d.get("cams") or [], "online": bool(d.get("plant_online")), "error": None}
        except Exception:
            out = {"cams": [], "online": False, "error": "Can't reach the relay. Check this PC's internet."}
        self._state[ulb] = (time.monotonic(), out)
        return out

    def camera(self, ulb, cam, quality):
        l = self.get(ulb)
        r = self._get(l, "/v1/sites/%s/live/%s.mjpg" % (l["site"], cam), params={"q": quality}, stream=True,
                      timeout=(10, 60))
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

"""Who may open the dashboard.

Users are set in the DASHBOARD_USERS environment variable, one per line or
separated by ";":

    name:password-hash                         All sites (state level)
    name:password-hash@nellore                 Site: one ULB
    name:password-hash@pkg:1                   Agency: one package
    name:password-hash@pkg:7|8|9|10            Multi-site: several packages
    name:password-hash@badvel|kamalapuram      Multi-site: chosen ULBs
Add "#Shown name" at the end for the name in the top bar, e.g.  ...@pkg:1#Iway Associates

Make a password hash with:  python -m dashboard.manage hash
Passwords are never stored, only PBKDF2 hashes (same scheme as the ISWM plant app).

In demo mode (no ISWM API set) with no users set, the design's demo logins exist, all with
password admin@sac: admin (all sites), nellore.site, iway.agency, dyee.varaprasad.
"""
import hashlib
import os
import secrets
import threading
import time

ITERATIONS = 200_000
DEMO_USER = ("admin", "admin@sac")
DEMO_USERS = [("admin", "", "State ISWM Cell"), ("nellore.site", "nellore", "Plant in-charge, Nellore"),
              ("iway.agency", "pkg:1", "Iway Associates"), ("dyee.varaprasad", "pkg:7|8|9|10", "DyEE Vara Prasad")]


def hash_password(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    return "pbkdf2$%s$%s" % (salt, hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), ITERATIONS).hex())


def check_password(pw, stored):
    if not stored or not stored.startswith("pbkdf2$"):
        return False
    _, salt, _ = stored.split("$", 2)
    return secrets.compare_digest(hash_password(pw, salt), stored)


def password_problem(pw):
    if len(pw or "") < 8:
        return "Use at least 8 characters."
    if pw.isdigit() or pw.isalpha():
        return "Use letters and numbers."
    return None


def load_users(text, demo):
    """{name: {"hash", "scope" (text, see registry.parse_scope), "who" (shown name)}}"""
    users = {}
    for item in (text or "").replace("\n", ";").split(";"):
        item = item.strip()
        if not item:
            continue
        name, _, rest = item.partition(":")
        rest, _, who = rest.partition("#")
        hashed, _, scope = rest.partition("@")
        if name and hashed.startswith("pbkdf2$"):
            users[name.strip()] = {"hash": hashed.strip(), "scope": scope.strip(), "who": who.strip() or name.strip()}
    if not users and demo:
        h = hash_password(DEMO_USER[1])
        for name, scope, who in DEMO_USERS:
            users[name] = {"hash": h, "scope": scope, "who": who}
    return users


class Throttle:
    """Five wrong passwords from one address or for one name: wait a minute."""

    def __init__(self, limit=5, wait=60):
        self.limit, self.wait = limit, wait
        self._fails, self._lock = {}, threading.Lock()

    def blocked(self, *keys):
        now = time.monotonic()
        with self._lock:
            return any(self._fails.get(k, (0, 0))[1] > now for k in keys)

    def failed(self, *keys):
        now = time.monotonic()
        with self._lock:
            for k in keys:
                n = self._fails.get(k, (0, 0))[0] + 1
                self._fails[k] = (n, now + self.wait if n >= self.limit else 0)

    def ok(self, *keys):
        with self._lock:
            for k in keys:
                self._fails.pop(k, None)


def secret_key():
    """SECRET_KEY signs the login cookie. Without it, a random one is made (logins end on restart)."""
    return os.environ.get("SECRET_KEY") or secrets.token_hex(32)

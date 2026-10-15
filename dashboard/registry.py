"""The 107 ULBs of the ISWM project, from the package progress sheet (as in the dashboard design).

Each package has an agency, a DyEE, awarded capacity (TPD) and its ULBs by status. A ULB's
estimated capacity is the package TPD shared equally. To change a status (for example a plant
starting), edit the lists below: ``op`` means the plant is in operation.
"""
import re

PACKAGES = [
    dict(n=1, ag="Iway Associates Pvt Ltd", dy="Jaydev", tpd=560, ulb=16,
         com=["Bobbili", "Amudalavalasa", "Palasa Kasibugga", "Ichapuram", "Rajam", "Pithapuram", "Peddapuram",
              "Yeleswaram", "Narsipatnam", "Palakonda"], op=["Narsipatnam", "Peddapuram", "Yeleswaram"],
         near=["Bobbili", "Amudalavalasa"], lanc=[], protest=[], legacy=["Salur", "Kakinada"],
         lna=["Tuni", "Samalkota", "Parvathipuram", "Gollaprollu"]),
    dict(n=2, ag="Cube Bio Energy Pvt Ltd", dy="Jaydev", tpd=725.21, ulb=13,
         com=["Ramachandrapuram", "Nidadavolu", "Mummidivaram", "Amalapuram", "Tanuku", "Rajamahendravaram", "Palcole",
              "Mandapeta"], op=[], near=["Ramachandrapuram"], lanc=[], protest=["Kovvuru"], legacy=["Tadepalligudem"],
         lna=["Narsapur", "Akiveedu", "Bhimavaram"]),
    dict(n=3, ag="United Petrochem Pvt Ltd", dy="Padmavathi", tpd=570, ulb=12,
         com=["Eluru", "Tiruvuru", "Nuzivid", "Kondapalli"], op=["Kondapalli"], near=["Tiruvuru"],
         lanc=["Chintalapudi", "Machilipatnam"], protest=["Nandigama"], legacy=["Gudivada", "Pedana", "Jaggaiahpet"],
         lna=["Jangareddygudem", "Vuyyuru"]),
    dict(n=4, ag="Johar Automobiles", dy="Lakshmi", tpd=535, ulb=15,
         com=["Addanki", "Macherla", "Piduguralla", "Dachepalli", "Vinukonda", "Ongole", "Chimakurthy", "Podili",
              "Kanigiri", "Darsi", "Giddalur", "Markapur"], op=[], near=["Giddalur", "Chimakurthy"], lanc=["Bapatla"],
         protest=[], legacy=["Chirala"], lna=["Gurajala"]),
    dict(n=5, ag="Lion Security Guards Services", dy="Lakshmi", tpd=565, ulb=7,
         com=["Nellore", "Alluru", "Gudur (N)", "Kandukur", "Kavali", "Atmakur (N)", "Buchireddypalem"], op=["Nellore"],
         near=["Gudur (N)", "Alluru"], lanc=[], protest=[], legacy=[], lna=[]),
    dict(n=6, ag="Raghuram Hume Pipe Pvt Ltd", dy="Lakshmi", tpd=530, ulb=10,
         com=["Nagari", "Palamaneru", "Punganur", "Venkatagiri", "Chittor", "Naidupet", "Tirupathi", "Srikalahasti"],
         op=[], near=["Nagari"], lanc=[], protest=["Sullurpeta"], legacy=[], lna=["Puttur"]),
    dict(n=7, ag="Sri Dharmasastha Contractors", dy="Vara Prasad", tpd=520, ulb=8,
         com=["Kadapa", "Proddatur", "Jammalamadugu", "Pulivendula", "Mydukur", "Kamalapuram", "Badvel"],
         op=["Badvel", "Kamalapuram"], near=["Jammalamadugu"], lanc=[], protest=[], legacy=[], lna=["Yerraguntla"]),
    dict(n=8, ag="Thirumala Constructions", dy="Vara Prasad", tpd=380, ulb=6,
         com=["Guntakal", "Kalyanadurgam", "Rayadurg", "Gooty"], op=[], near=[], lanc=["Tadipatri", "Anantapur"],
         protest=[], legacy=[], lna=[]),
    dict(n=9, ag="Lion Security Guards Services", dy="Vara Prasad", tpd=630, ulb=14,
         com=["Dharmavaram", "Puttaparthi", "Adoni", "Rajampet", "Rayachoty", "B.Kothakota", "Hindupur", "Madanapalli",
              "Yemmiganur", "Kadiri", "Atmakur (K)", "Allagadda", "Madakasira"], op=[], near=[], lanc=[],
         protest=["Penukonda"], legacy=[], lna=[]),
    dict(n=10, ag="Sai Pavani Constructions India Pvt Ltd", dy="Vara Prasad", tpd=370, ulb=6,
         com=["Dhone", "Nandikotkur", "Nandyala", "Kurnool", "Betamcherla"], op=["Betamcherla"], near=["Dhone"],
         lanc=[], protest=[], legacy=[], lna=["Guduru (K)"]),
]
AWARDED_TPD = 5385.21
OP_START = "2026-07-18"  # first plants in operation
STATUS_ORDER = ["op", "near", "wip", "lanc", "legacy", "protest", "lna"]


def ulb_id(name):
    return re.sub(r"[^a-z]+", "-", name.lower()).strip("-")


def _build():
    out = []
    for p in PACKAGES:
        cap = round(p["tpd"] / p["ulb"])

        def add(name, status):
            out.append({"id": ulb_id(name), "name": name, "pk": p["n"], "ag": p["ag"], "dy": p["dy"],
                        "status": status, "cap": cap})
        for n in p["com"]:
            add(n, "op" if n in p["op"] else "near" if n in p["near"] else "wip")
        for k in ("lanc", "legacy", "protest", "lna"):
            for n in p[k]:
                add(n, k)
    return out


ULBS = _build()
BY_ID = {u["id"]: u for u in ULBS}
OPS = [u["id"] for u in ULBS if u["status"] == "op"]


# --- who sees what ---------------------------------------------------------------------------
def parse_scope(text):
    """'' or 'all' = every ULB; 'pkg:7|8|9|10' = those packages; 'nellore|badvel' = those ULBs."""
    text = (text or "").strip()
    if not text or text == "all":
        return {"kind": "all"}
    if text.startswith("pkg:"):
        return {"kind": "pkg", "pk": sorted({int(x) for x in text[4:].split("|") if x.strip().isdigit()})}
    return {"kind": "ulb", "ids": [x for x in text.split("|") if x in BY_ID]}


def in_scope(scope, u):
    if scope["kind"] == "all":
        return True
    if scope["kind"] == "pkg":
        return u["pk"] in scope["pk"]
    return u["id"] in scope["ids"]


def describe(scope):
    """(access label, scope label) as in the design: Site / Agency / Multi-site / All sites."""
    sc = [u for u in ULBS if in_scope(scope, u)]
    if scope["kind"] == "all":
        return "All sites", "All %d ULBs" % len(ULBS)
    if scope["kind"] == "pkg":
        pk = scope["pk"]
        if len(pk) == 1:
            return "Agency", "Package %d · %d ULBs" % (pk[0], len(sc))
        span = "%d–%d" % (pk[0], pk[-1]) if pk == list(range(pk[0], pk[-1] + 1)) else ", ".join(map(str, pk))
        return "Multi-site", "Packages %s · %d ULBs" % (span, len(sc))
    if len(sc) == 1:
        return "Site", "ISWM " + sc[0]["name"]
    return "Multi-site", "%d ULBs" % len(sc)

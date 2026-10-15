# ISWM Dashboard

The dashboard for the Integrated Solid Waste Management Project, Govt of Andhra Pradesh, built to the **ISWM Dashboard** design.

- **Public landing page** (no sign in):
  - **Live ULBs**: today's or any day's trips, inward tonnes, plants in operation and trips per hour, for all operational plants or one;
  - **Upcoming ULBs**: pending ULBs, awarded vs live capacity, pending sites by agency and by cluster.
- **Sign in**, then four tabs, limited to the ULBs that person may see:
  - **Overview**: collection trips, waste received, windrowed, recycled, sent out, kept from landfill; trend chart; where the waste went; outward destinations; latest weighments. Today / 7 days / 30 days / This year, one plant or all.
  - **Sites**: every ULB in their access with status, capacity, trips, received, utilisation, kept from landfill, incomplete records and sync.
  - **Cameras**: the plant's live cameras, with the names given at the plant, through the ISWM relay.
  - **Reports**: trips grouped by vehicle, hour, shift, day, month, year, site, material or destination, any date range; download as CSV or Excel.

It runs on **demo data** until it is pointed at the ISWM API (sample trips for the 8 operational ULBs, moving camera pictures).

```
 Plant PC (ISWM app)  ──sync──▶  Firestore  ◀──reads──  ISWM API (cloud_api, Cloud Run)  ◀──  this dashboard  ◀──  browser
        └────────── camera pictures, only while someone watches ──────────▶ relay ┘
```
The dashboard uses the ISWM API from the [ISWM repo](https://github.com/tsaaii/ISWM) (`cloud_api`) with one API key that stays on this server; the browser never sees it.

## Try it on your PC (demo data)

Windows Command Prompt, in this folder:
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m dashboard.app
```
Open http://127.0.0.1:8080. Sign in with **admin** / **admin@sac** (all sites). The design's other demo logins use the same password: **nellore.site** (Site), **iway.agency** (Agency, package 1), **dyee.varaprasad** (Multi-site, packages 7–10).

## Show one plant's live cameras (camera links)

Sign in with an **All sites** login (in demo: admin / admin@sac) → **Cameras** → **Configure cameras**. Paste the plant's live link from the ISWM relay, for example:
```
https://iswm-api-….run.app/live/iswm-ananthapur?key=VIEWER-KEY
```
and press **Save link**. The ULB is found from the link (`iswm-ananthapur` → Anantapur); pick it from the list if it isn't.

From then on the dashboard shows **only the linked plants**, on the landing page and every tab. Their cameras come live from the relay, and their numbers come from the ISWM API, or from demo data if `ISWM_API_URL` isn't set. Remove the link to go back to all plants.

- Links are saved in `dashboard_data/links.json` next to where you start the dashboard (`DASHBOARD_DATA` changes the folder).
- On Cloud Run that folder is wiped at each restart, so set links there with `CAMERA_LINKS="anantapur=https://…/live/iswm-ananthapur?key=…"` (several separated by `;`).
- The viewer key stays on the server; the settings panel shows it masked.

## The ULB list

The 107 ULBs, 10 packages, agencies, DyEEs, awarded TPD and each ULB's status are in `dashboard/registry.py`, from the package progress sheet. When a plant starts, move its name into that package's `op` list; it then appears on the landing page, in Overview and in Sites.

A ULB is matched to its plant by name: ULB *Nellore* is plant site `iswm-nellore` (the plant app's default site id) or `nellore`. If a plant uses another id, set `SITE_MAP=nellore=my-site-id,badvel=...`.

## Users and what they see

Users are set in `DASHBOARD_USERS`, separated by `;`. Make each line with:
```
python -m dashboard.manage hash
```
It prints `name:pbkdf2$…`. Add what the person may see, and the name for the top bar:

| Line ends with | Access shown | Sees |
|---|---|---|
| *(nothing)* | All sites | all 107 ULBs |
| `@nellore` | Site | one ULB |
| `@pkg:1` | Agency | one package |
| `@pkg:7\|8\|9\|10` | Multi-site | those packages |
| `@badvel\|kamalapuram` | Multi-site | those ULBs |

Add `#Shown name` at the very end, for example `iway:pbkdf2$...@pkg:1#Iway Associates`.

- Passwords are stored only as PBKDF2 hashes.
- Five wrong tries from one address or for one name blocks sign in for a minute.
- A sign-in lasts 12 hours.
- The demo logins exist only while no ISWM API and no users are set.

## Put it on Google Cloud Run

1. **Make an API key for the dashboard in the ISWM API.** Add it to `API_KEYS` of your `iswm-api` service. `--update-env-vars` keeps the other keys, but replaces the whole `API_KEYS` list, so include every key:
   ```
   gcloud run services describe iswm-api --region asia-south1
   gcloud run services update iswm-api --region asia-south1 --update-env-vars "^@@^API_KEYS=owner:OLD-KEY,dashboard:NEW-LONG-RANDOM-KEY"
   ```
   The first command shows the current `API_KEYS`. The `^@@^` at the start lets the value contain commas.
2. **Deploy the dashboard** (one line, from this folder):
   ```
   gcloud run deploy iswm-dashboard --source . --region asia-south1 --allow-unauthenticated --timeout 3600 --set-env-vars "^@@^ISWM_API_URL=https://iswm-api-XXXX.run.app@@ISWM_API_KEY=NEW-LONG-RANDOM-KEY@@SECRET_KEY=ANOTHER-LONG-RANDOM-TEXT@@DASHBOARD_USERS=ravi:pbkdf2$..."
   ```
   - `--allow-unauthenticated` lets anyone open the public landing page (totals only). Everything after Sign in needs a login.
   - `SECRET_KEY` keeps people logged in when Cloud Run restarts the service. Use 40+ random characters.
   - For a long user list, keep it in Secret Manager and use `--set-secrets DASHBOARD_USERS=dashboard-users:latest` instead.
3. Open the `https://iswm-dashboard-….run.app` address it prints.

To deploy a new version later, run the same command **without** `--set-env-vars`; the settings stay.

## Cost and data

- **Landing page:** public, totals only (no vehicle numbers). Figures are kept 30 seconds, so many visitors don't multiply reads.
- **Signed-in pages:** read the trips of the chosen plants and dates through the ISWM API. Today's trips are kept 2 minutes and older days 30 minutes. Each trip is one Firestore read the first time. *This year* across all plants is the heaviest view: [Likely] a few thousand trips per plant per month, so open it sparingly once many plants are live. Firestore's free tier is 50,000 reads a day.
- **Cameras:** plant → relay → dashboard → browser, only while the Cameras tab is open. Normal quality is about 0.1–0.2 GB an hour per camera shown. A view stops by itself after 10 minutes.
- Cloud Run runs only while pages are open.

## Needs from the ISWM side

ISWM 1.5.0 or newer on the plant PCs, so camera names reach the Cameras tab. Trips come from any version that syncs to Firestore.

## Files

| File | What it is |
|---|---|
| `dashboard/app.py` | Pages, sign in, data for the pages, camera pass-through |
| `dashboard/registry.py` | The 107 ULBs, packages, statuses, and access scopes |
| `dashboard/data.py` | `DemoData` (sample) and `ApiData` (the real ISWM API) |
| `dashboard/auth.py` | Users, password hashes, wrong-password limit |
| `dashboard/manage.py` | `python -m dashboard.manage hash` |
| `dashboard/templates/` | Page shells and the sign-in page |
| `dashboard/static/app.js` | Draws the landing page and the four tabs (no libraries) |
| `dashboard/static/tokens.css` | The design's colours, type and spacing (Palatino Linotype from the computer; no font files shipped) |
| `tests/` | `python -m pytest -q tests` |

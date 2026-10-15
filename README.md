# ISWM Dashboard

All ISWM plants on one screen: who is online, today's inward and outward tonnes, trips waiting for an empty weight, every trip with its vehicle number, a 14-day chart, and **live cameras from each plant** with the names given at the plant (Front cam, Tipping floor, Windrow yard…).

It has a login, and it works straight away with **demo data**: made-up plants, trips and moving camera pictures. Point it at your ISWM API and it shows the real plants.

```
 Plant PC (ISWM app)  ──sync──▶  Firestore  ◀──reads──  ISWM API (cloud_api, Cloud Run)  ◀──  this dashboard  ◀──  your browser
        └────────── camera pictures, only while someone watches ──────────▶ relay ┘
```

The dashboard never talks to Firestore or the plants directly. It uses the ISWM API from the [ISWM repo](https://github.com/tsaaii/ISWM) (`cloud_api`), with one API key that stays on this server. The browser only sees the dashboard.

## Try it on your PC (demo data)

Windows Command Prompt, in this folder:
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m dashboard.app
```
Open http://127.0.0.1:8080 and log in with **demo** / **demo1234**.

## Screens

- **Plant status (the first page after login):** one card per plant, problems first. Each card is green *Working*, yellow *Needs attention* or red *Offline*, and says why in plain words, for example *Weighbridge not connected*, *Camera problem: Tipping floor*, *Cloud sync error*, *No contact since 15 Oct 08:15*. Each card shows:
  - last seen, weighbridge on/off with the live weight, cameras working, records waiting to sync;
  - today's inward and outward tonnes and trips, pending empty weights;
  - who is on duty and the app version.

  Filters: *All*, *Needs attention*, *Offline*, *Working*. *Table* view for many plants. Below the cards: **trips per hour today across all plants** and **inward today by plant**. Refreshes every 30 seconds.
- **One plant:**
  - status strip (same reasons as the card), live weighbridge reading and today's totals;
  - **Day** (pick any day, or Today / Yesterday): **trips per hour** with the busiest hour, **shift totals**, inward by **waste type** and **source**, outward by **material** and **destination**, **busiest vehicles**, **waiting for empty weight**, and **Download trips (CSV)** for Excel;
  - **Cameras**: one button per camera, named as at the plant, plus **All**. Low data, Normal or Sharper; Stop. Nothing is sent from the plant until you press a camera, and a view stops by itself after 10 minutes;
  - **Last 14 days**: inward and outward tonnes per day. Hover for the numbers, or press *Show as table*;
  - **Trips**: any day, inward/outward filter, search by vehicle or ticket.

## Users and login

Users are set in `DASHBOARD_USERS`. Make a line for each person:
```
python -m dashboard.manage hash
```
It asks for a name and password and prints something like `ravi:pbkdf2$…`. Put several users together with `;`. To let someone see only some plants, add `@site-a|site-b`:
```
DASHBOARD_USERS=ravi:pbkdf2$...;kadiri-manager:pbkdf2$...@iswm-kadiri
```
- Passwords are stored only as PBKDF2 hashes.
- Five wrong tries from one address or for one name blocks login for a minute.
- A login lasts 12 hours.
- The demo user exists only while no ISWM API is set and no users are set.

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
   - `--allow-unauthenticated` only means Cloud Run lets the request reach the dashboard; the dashboard's own login still protects every page.
   - `SECRET_KEY` keeps people logged in when Cloud Run restarts the service. Use 40+ random characters.
   - For a long user list, keep it in Secret Manager and use `--set-secrets DASHBOARD_USERS=dashboard-users:latest` instead.
3. Open the `https://iswm-dashboard-….run.app` address it prints.

To deploy a new version later, run the same command **without** `--set-env-vars`; the settings stay.

## Cost and data

- **Status:** each plant tells the relay how it is (weighbridge, cameras, records waiting, version) with the check-in it already makes every ~20 seconds; about 200 bytes. The dashboard asks the relay for all plants in one call every 15 seconds. No Firestore reads. A plant counts as online if it checked in within a minute, or, if remote view is off at that plant, synced within 2 hours.
- **Overview:** reads one record per plant (today's totals, written by the plant at each sync), at most once a minute however many people are looking. 123 plants ≈ 123 Firestore reads a minute while the page is open, about 180,000 for a full day left open. Firestore's free tier is 50,000 a day; past that it costs about $0.06 per 100,000 reads.
- **Plant page:** reads the trips of the chosen day and the last 14 days, kept 2 minutes.
- **Cameras:** the picture goes plant → relay → dashboard → browser. Normal quality is about 0.1–0.2 GB an hour per camera watched; *All* on a plant with 4 cameras is 4 times that. Nothing is sent while nobody watches.
- Cloud Run runs only while pages are open, so an idle dashboard costs nothing.

## Needs from the ISWM side

ISWM 1.5.0 or newer on the plant PCs: it sends camera names, today's totals and trips per hour with each sync, and its status with each relay check-in (turn on *Remote camera view* at the plant for the live status). Older plants still show, with zero totals and no camera names until they update.

## Files

| File | What it is |
|---|---|
| `dashboard/app.py` | Pages, login, JSON for the pages, camera pass-through |
| `dashboard/data.py` | `DemoData` (made-up) and `ApiData` (the real ISWM API) |
| `dashboard/auth.py` | Users, password hashes, wrong-password limit |
| `dashboard/manage.py` | `python -m dashboard.manage hash` |
| `dashboard/templates/` | Page layouts |
| `dashboard/static/` | Styling and the page script (no libraries) |
| `tests/` | `python -m pytest -q tests` |

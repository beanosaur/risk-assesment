# Site Risk Assessment

A phone app for risk-assessing English Civil War reenactment sites: battle, living history, members' camping and public areas.

## What it does

- **Event details**: site, date, assessor, activities, and the site's GPS position.
- **Photos**: take or upload site photos with a note on each.
  - **✨ Spot hazards**: an AI vision model suggests hazards it can see in the photo. You add or dismiss each one. Needs a one-off setup: see [`worker/README.md`](worker/README.md).
  - **📌 Mark hazards**: tap a photo to pin numbered hazard markers on it.
- **Site plan**: add a satellite screenshot, sketch or organiser's plan and mark the battle area, crowd line, camp, powder store, fire points, first aid, emergency access and more.
- **Hazard checklist** filtered by activity, scored likelihood × severity (1–5) before and after site-specific controls. Add your own hazards.
- **Emergency and key info**: first aid point, nearest A&E, emergency RV, real-casualty and stop signals, safety officer, landowner.
- **On the day**:
  - Weather forecast for the site and date (Open-Meteo, no key needed), with warnings for heat, cold, rain, wind and thunderstorms.
  - A timed conditions log: what changed, what you did, and any hazard re-scored.
- **Sign-off**: assessor and event commander sign on the screen with a finger.
- **Report**: full printable report with numbered hazards, marked photos, site plan, log and signatures. **Print / Save as PDF** from the phone.
- **Safety briefing**: a one-page summary of key info and the medium/high risks, to print or **Share** as text (WhatsApp, email).
- **Copy for a new event**: reuse last year's assessment of the same site, then re-walk and re-check.
- **Export / import**: send an assessment to another phone as a file.

Everything is saved on the phone (IndexedDB), and the app keeps working offline once it has been opened. Weather and photo hazard spotting need signal.

## Using it on Android

The app is a plain web app served from GitHub Pages. Open it in Chrome, then use **⋮ → Add to Home screen** to install it like an app.

## Customising the hazards

The checklist is in `data/hazards.json`. Each hazard has an `id`, `area`, `hazard`, `who`, standard `controls`, and the `activities` it applies to. The plan is to replace this starter list with the checklists from the Sealed Knot risk assessment workbook.

## Risk bands

| Score | Band |
|---|---|
| 1–4 | Low |
| 5–12 | Medium |
| 15–25 | High |

# Site Risk Assessment

A phone app for risk-assessing English Civil War reenactment sites: battle, living history, members' camping and public areas.

## What it does

- Start an assessment for an event: site, date, assessor, and which activities are taking place.
- Take or upload photos of the site, with a note on each.
- Work through a hazard checklist (black powder, pike, cavalry, fires, guy ropes, crowd line, weather and more), filtered by the activities you picked.
- Score each hazard for likelihood × severity (1–5), before and after site-specific controls.
- Add your own site-specific hazards.
- View a printable report and **Print / Save as PDF** from the phone.

Everything is saved on the phone (IndexedDB), and the app keeps working offline once it has been opened.

## Using it on Android

The app is a plain web app, so it needs to be served from a web address (for example, GitHub Pages). Open it in Chrome, then use **⋮ → Add to Home screen** to install it like an app.

## Customising the hazards

The checklist is in `data/hazards.json`. Each hazard has an `area`, `hazard`, `who`, standard `controls`, and the `activities` it applies to. The plan is to replace this starter list with the checklists from the Sealed Knot risk assessment workbook.

## Risk bands

| Score | Band |
|---|---|
| 1–4 | Low |
| 5–12 | Medium |
| 15–25 | High |

## Not yet included

- Automatic hazard spotting from photos (this would need an image-analysis service).
- Sharing assessments between phones.

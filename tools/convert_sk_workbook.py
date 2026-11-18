#!/usr/bin/env python3
"""Convert the Sealed Knot risk assessment workbook (SK_RA_*.xlsx) into a private checklist file.

Usage:  python3 tools/convert_sk_workbook.py path/to/SK_RA_Oct_23.xlsx [sealed-knot-checklist.json]

The output is loaded into the app from Settings -> Load checklist file and stays on the phone.
Do NOT commit the output to this public repository: the Sealed Knot's text is not for publishing.

Each RA sheet becomes a section ("activity") in the app. Rows are grouped by the
"Activity/Hazard" column; the "Risk" texts become the hazard's risks, and the control
measures are collected in order. The workbook's own ratings are kept as the SK standard
rating, with the band taken from the coloured column it sits in (red / amber / green).

The workbook's sheets were built from a construction template, so everything from the
"Specific Training" row down (drilling, HAV, PAT testing...) is ignored, apart from the
training lines and a few genuine SK lines listed in KEEP_FROM_TEMPLATE_AREA.

Extra walk-round checks that the workbook doesn't cover are kept from EXTRA_CHECKS below.
"""
import json, re, sys, warnings
from pathlib import Path

warnings.filterwarnings('ignore')
import openpyxl

BANDS = {'D': 'high', 'E': 'med', 'F': 'low'}       # rating with no controls
RBANDS = {'I': 'high', 'J': 'med', 'K': 'low'}      # residual risk
BAND_ORDER = {'low': 1, 'med': 2, 'high': 3}

# From the cover sheet: who may be affected, by RA. RAs it doesn't list are filled in from the sheet's own text.
WHO = {
    1: 'Members, other people on site, public', 2: 'Members, other people on site, public',
    3: 'Members, public', 4: 'Members', 5: 'Members', 6: 'Members', 7: 'Members',
    8: 'Members, other people on site', 9: 'Members, other people on site',
    10: 'Members, other people on site', 11: 'Members, public', 12: 'Members, other people on site',
    13: 'Members, public', 14: 'Members, public', 15: 'Members, public, children',
    16: 'Members, public', 17: 'Members, public',
}
# Training lines that came from the construction template or were copied between sheets.
SKIP_TRAINING = {'CSCS/ Manual Handling'}
SKIP_TRAINING_FOR = {12: None, 15: 'Bad weather planning', 16: 'Bad weather planning', 17: 'Bad weather planning'}
# Genuine SK lines that sit inside the template area of a sheet.
KEEP_FROM_TEMPLATE_AREA = {11: ['THE CHAIN OF COMMAND']}  # line prefixes
DEFAULT_ON = ['ra1', 'ra2', 'ra4', 'ra8', 'ra9', 'ra10', 'ra11', 'ra12', 'extra']

EXTRA_CHECKS = [
    ('ground-uneven', 'Uneven ground, holes, rabbit burrows', 'Members, public', 'Walk the field before the event; mark or fill holes; brief units on known hazards.'),
    ('ground-slope', 'Steep slopes or banks', 'Members, cavalry, public', 'Keep battle lines off steep ground; tape off banks; position public on level ground.'),
    ('water', 'Open water, ditches, rivers (drowning, falls)', 'All, especially children', 'Fence or tape off; keep battle and camp clear; brief stewards.'),
    ('overhead-lines', 'Overhead power lines (pikes, colours, tent poles)', 'Pikemen, ensigns, campers', 'Mark on the site plan; exclusion zone with no pikes or poles raised beneath.'),
    ('trees', 'Trees, low branches, dead wood', 'All, cavalry', 'Check for dead branches; keep cavalry clear of low branches; no camping under unsafe trees.'),
    ('livestock', 'Livestock, dung, barbed or electric fencing', 'All', 'Agree with landowner to remove stock; mark electric fences; clear dung from the battle area.'),
    ('guy-ropes', 'Guy ropes and tent pegs (tripping)', 'Campers, public', 'Mark guy ropes; peg caps; keep walkways clear; lighting at night.'),
    ('gas', 'Gas cylinders and stoves', 'Campers', 'Cylinders upright, outside tents, away from fires; check hoses; no gas in the living history area.'),
    ('alcohol', 'Alcohol around fires, weapons and powder', 'Members', 'No drinking before or during battle; no powder handling after drinking; camp rules briefed.'),
    ('wind-lightning', 'High wind or lightning', 'All', 'Stop activity in lightning; lower pikes and colours; secure tents and gazebos.'),
    ('cold-wet', 'Cold and wet weather', 'All', 'Check the forecast; dry clothing; warm shelter available.'),
    ('lost-child', 'Lost children', 'Public', 'Lost child point; stewards briefed; announcement procedure.'),
    ('welfare', 'Toilets, drinking water, hand washing', 'All', 'Enough toilets and water points; hand washing near food.'),
    ('manual-handling', 'Manual handling (tents, guns, equipment)', 'Members', 'Team lifts; use trolleys; brief on safe lifting.'),
]


def clean(v):
    if v is None:
        return ''
    s = str(v).replace('\xa0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    s = '\n'.join(line.strip() for line in s.split('\n'))
    return re.sub(r'\n{2,}', '\n', s).strip()


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40]


def convert(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    version = clean(wb['Cover Sheet']['I2'].value).replace('Version:', 'version ').strip()
    activities, hazards, notes = [], [], {}
    for ws in wb.worksheets:
        m = re.match(r'\s*RA\s*(\d+)\s+(.*)', ws.title)
        if not m:
            continue
        n = int(m.group(1))
        # Sheet names are tidier than some sheet titles (RA17's title still says Banquets).
        name = {9: 'Pedestrians and Traffic in Camping Areas', 12: 'Leaving and Entering Campsite', 14: 'Marching on Public Highways'}.get(n, m.group(2).strip())
        act = f'ra{n}'
        activities.append({'id': act, 'name': f'RA{n} {name}'})
        groups, cur, training, in_template = [], None, [], False
        for row in ws.iter_rows(min_row=4):
            cells = {c.column_letter: c.value for c in row if c.value not in (None, '')}
            if not cells:
                continue
            label = clean(cells.get('E'))
            if label in ('Specific Training', 'General Training'):
                in_template = True
                t = clean(cells.get('H'))
                skip = SKIP_TRAINING_FOR.get(n, '')
                if t and t not in SKIP_TRAINING and skip is not None and t != skip:
                    training.append(f'{label}: {t}')
                continue
            if in_template:
                t = clean(cells.get('H'))
                if any(t.startswith(k) for k in KEEP_FROM_TEMPLATE_AREA.get(n, [])):
                    training.append(t)
                continue
            b, c, h = clean(cells.get('B')), clean(cells.get('C')), clean(cells.get('H'))
            if h in ('·', '.'):
                h = ''
            b = b.rstrip('.')
            if b:
                cur = {'hazard': b, 'risks': [], 'controls': [], 'rating': None, 'residual': None}
                groups.append(cur)
            if cur is None:
                continue
            if c and c not in cur['risks']:
                cur['risks'].append(c)
            if h and h not in cur['controls']:
                cur['controls'].append(h)
            for col, band in BANDS.items():
                v = cells.get(col)
                if isinstance(v, (int, float)):
                    r = cur['rating']
                    if not r or (BAND_ORDER[band], v) > (BAND_ORDER[r['band']], r['score']):
                        cur['rating'] = {'score': v, 'band': band}
            for col, band in RBANDS.items():
                v = cells.get(col)
                if isinstance(v, (int, float)):
                    r = cur['residual']
                    if not r or (BAND_ORDER[band], v) > (BAND_ORDER[r['band']], r['score']):
                        cur['residual'] = {'score': v, 'band': band}
        seen = set()
        for g in groups:
            hid = f'{act}-{slug(g["hazard"])}'
            while hid in seen:
                hid += '-2'
            seen.add(hid)
            hazards.append({
                'id': hid, 'activities': [act], 'area': f'RA{n} {name}', 'source': f'RA{n}',
                'hazard': g['hazard'], 'risk': '; '.join(g['risks']), 'who': WHO.get(n, ''),
                'controls': '\n'.join(g['controls']), 'sk': {'rating': g['rating'], 'residual': g['residual']},
            })
        if training:
            notes[act] = training
    activities.append({'id': 'extra', 'name': 'Extra site walk-round checks'})
    for hid, hz, who, ctl in EXTRA_CHECKS:
        hazards.append({'id': hid, 'activities': ['extra'], 'area': 'Extra site walk-round checks', 'source': 'extra',
                        'hazard': hz, 'risk': '', 'who': who, 'controls': ctl})
    return {
        'type': 'checklist',
        'version': 2,
        'source': f'Sealed Knot Risk Assessment workbook ({re.sub(r"^[0-9a-f]{8}-", "", Path(path).name)}, {version})',
        'note': 'RA1–RA17 from the Sealed Knot workbook, plus extra walk-round checks that are not in it.',
        'bands': {'high': 'High (red)', 'med': 'Medium (amber)', 'low': 'Low (green)'},
        'defaultActivities': DEFAULT_ON,
        'activities': activities,
        'activityNotes': notes,
        'hazards': hazards,
    }


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    out = Path(sys.argv[2] if len(sys.argv) == 3 else 'sealed-knot-checklist.json')
    data = convert(sys.argv[1])
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'Wrote {len(data["hazards"])} hazards in {len(data["activities"])} sections to {out}')

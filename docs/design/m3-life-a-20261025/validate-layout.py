#!/usr/bin/env python3
"""Validate the frozen A layout against actual v2 bytes, without runtime writes."""
import hashlib
import json
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]


def read(name):
    return json.loads((ROOT / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cells(layout, field):
    b = layout['bounds']
    return {(x + b['minX'], y + b['minY'])
            for y, row in enumerate(layout[field])
            for x, bit in enumerate(row) if bit == '1'}


def bfs(allowed, start):
    parent = {start: None}
    q = deque([start])
    while q:
        x, y = q.popleft()
        for p in [(x-1, y), (x+1, y), (x, y-1), (x, y+1)]:
            if p in allowed and p not in parent:
                parent[p] = (x, y)
                q.append(p)
    return parent


def route(parent, end):
    assert end in parent, ('unreachable', end)
    result = []
    while end is not None:
        result.append(list(end))
        end = parent[end]
    return list(reversed(result))


def validate():
    delta = read('geometry-delta.json')
    manifest = read('spatial-manifest.json')
    base_path = REPO / delta['baseFile']
    base = json.loads(base_path.read_text())
    layout = read('world-map-life-v1.json')
    assert sha(base_path) == delta['baseSha256']
    assert sha(ROOT / delta['newFile']) == delta['newSha256'] == manifest['map']['layoutSha256']
    before, after = cells(base, 'walkableMask'), cells(layout, 'walkableMask')
    physical, unopened = cells(layout, 'physicalBlockedMask'), cells(layout, 'outsideWalkableMask')
    added = set(map(tuple, delta['addedWalkable']))
    assert len(before) == 1150 and len(after) == 1175 and len(added) == 25
    assert after - before == added and before <= after
    assert physical == cells(base, 'physicalBlockedMask') and len(physical) == 1622
    assert unopened == cells(base, 'outsideWalkableMask') - added and len(unopened) == 2835
    assert not (after & physical or after & unopened or physical & unopened)
    assert len(after | physical | unopened) == 88 * 64
    assert cells(layout, 'blockedMask') == physical | unopened
    for key in ['bounds', 'origin', 'spawn', 'commons', 'buildings', 'physicalBlocked', 'props', 'water', 'bridges', 'docks', 'stairs', 'retainingWalls', 'garden']:
        assert layout[key] == base[key], ('unexpected legacy change', key)
    stations = [s for p in manifest['places'] for s in p['stations']]
    station_cells = [tuple(c) for s in stations for c in s['cells']]
    waiting = [tuple(c) for p in manifest['places'] for c in p['waitingCells']]
    assert len(station_cells) == len(set(station_cells)) == 13
    assert len(waiting) == len(set(waiting)) == 6
    assert not set(station_cells) & set(waiting)
    occupied = set(station_cells + waiting)
    assert occupied <= after
    start = tuple(layout['spawn']['cell'])
    parent = bfs(after - occupied, start)
    assert not (before - occupied - set(parent)), 'old public routes disconnected'
    entrances = {b['id']: b['entrance']['cell'] for b in layout['buildings']}
    assert len(entrances) == 31
    for entrance in entrances.values():
        assert tuple(entrance) in parent
    route_records = []
    for p in manifest['places']:
        for c in p['entrances'] + p['publicBypassCells']:
            assert tuple(c) in parent, ('blocked entrance/bypass', p['placeId'], c)
        for s in p['stations']:
            seat = tuple(s['cells'][0])
            approach = tuple(s['approachCells'][0])
            assert abs(seat[0]-approach[0])+abs(seat[1]-approach[1]) == 1
            route_records.append({'station': s['id'], 'seat': list(seat), 'pathToApproachWithAllSeatsAndWaitingOccupied': route(parent, approach)})
            own_parent = bfs(after - (occupied - {seat}), start)
            assert seat in own_parent
    for n in manifest['npcs']:
        assert tuple(n['initialCell']) in after
        assert tuple(n['dutyCell']) in after
        for c in n['approachCells']:
            assert tuple(c) in parent
    for c in manifest['preserve']['notice']['approachCells']:
        assert tuple(c) in parent
    # The two A work choices can reach the free rest approach when all other seats are occupied.
    journeys = []
    rest = tuple(manifest['places'][2]['stations'][0]['approachCells'][0])
    for p in manifest['places'][:2]:
        origin = tuple(p['stations'][0]['approachCells'][0])
        path = route(bfs(after - occupied, origin), rest)
        journeys.append({'from': p['placeId'], 'to': 'garden_bench', 'steps': len(path)-1, 'segmentsAtMax64': ((len(path)-2)//64)+1, 'path': path})
    return {'status': 'PASS', 'scope': 'offline geometry proof, not deployed gameplay or dynamic scheduler acceptance',
            'baseSha256': delta['baseSha256'], 'layoutSha256': delta['newSha256'],
            'manifestSha256': sha(ROOT / 'spatial-manifest.json'),
            'counts': {'oldWalkable': 1150, 'newWalkable': 1175, 'added': 25, 'physicalUnchanged': 1622, 'entrancesReachable': 31, 'stations': 13, 'waiting': 6, 'npcInitialDuty': 4},
            'oldPublicDisconnected': 0, 'stationRoutes': route_records, 'twoChoicesToFreeRest': journeys,
            'limits': ['Runtime geometryDigest belongs to existing server converter', 'No database, account, activity, rewards or production service changed', 'No full congestion, business rule or responsive UI acceptance claimed']}


if __name__ == '__main__':
    report = validate()
    (ROOT / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['status', 'layoutSha256', 'manifestSha256', 'counts', 'oldPublicDisconnected']}, ensure_ascii=False))

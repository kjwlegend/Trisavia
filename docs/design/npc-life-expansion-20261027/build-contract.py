from pathlib import Path
from collections import deque
import json,hashlib
R=Path(__file__).parent
def read(p):return json.loads((R/p).read_text())
def save(p,d):(R/p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
M=read('reference/world-map-expansion-v1.json'); S=read('reference/spatial-manifest-expansion-v1.json')
def src(c):return [520+16*c[0],520+16*c[1]]
def point(c):return {'cell':c,'source':src(c)}
def reception(id,name,place,cell,ap,wait,look):
    return {'npcId':id,'name':name,'dutyRegionId':place,'duty':point(cell),'approach':point(ap),'waiting':point(wait),'receptionCapacity':1,'waitingCapacity':1,'waitingMaxSeconds':120,'receptionDistance':'Manhattan <= 1 to current authoritative NPC cell; no remote reception','lookId':look,'catalogVersion':'2026-10-27.npc-life-v1','permanentPhysicalCollision':False,'activeBodyCollision':'existing authoritative body occupancy only','movement':'duty is an availability anchor, never a permanent current position'}
npcs=[reception('npc-gardener','青禾','pine-walk',[-17,46],[-16,46],[-17,45],'pixel-crawler-qinghe-v1'),reception('npc-tea-companion','小满','harbor_tavern',[56,17],[55,17],[56,18],'pixel-crawler-xiaoman-v1'),reception('npc-trail-guide','闻溪','east-street',[74,21],[73,21],[75,21],'pixel-crawler-wenxi-v1')]
care=[]
for id,kind,cell,ap,wait,target in [('pine-care-water-01','watering',[-12,44],[-13,44],[-13,45],[-11,44]),('pine-care-clean-01','cleaning',[-7,47],[-8,47],[-8,48],[-6,47])]:
    care.append({'stationId':id,'careKind':kind,'regionId':'pine-walk','capacity':1,'station':point(cell),'approach':point(ap),'waiting':point(wait),'waitingCapacity':1,'waitingMaxSeconds':120,'target':point(target),'facing':'right','physicalCollision':False,'occupancy':'only active actor and explicitly accepted waiting; no static blocked cells','groundOverlay':{'file':'assets/care-'+kind+'.png','frameSize':[32,32],'pivot':[16,24],'anchorSource':src(target),'layer':'ground, before all bodies and existing occluders','boundsRelativeToAnchor':[-16,-24,32,32]},'activeActorOverlayBounds':[-16,-24,32,32],'stateBinding':{'neutral':'No committed care result; never infer weather or urgency','active':'matching current authoritative careKind + active activity at station','completed':'matching committed care record; lastCareAt + actorId + careKind; never local timer','cancelled':'remove active FX and retain last committed result','cooldownEnded':'watering: remove wet glints at authoritative care cooldown end, retain lastCareAt record; cleaning: retain collected leaves and keep unavailable until actual new cleanable material exists'},'visualFrames':{'neutral':[0],'active':[0 if kind=='watering' else 1],'completed':[2 if kind=='watering' else 3]},'availabilityGate':'watering requires usable fixed tool and active/result visuals; cleaning requires actual cleanable material state and collected result visuals, otherwise disabled','careBoard':{'type':'anchored interaction label, no physical furniture','anchorCell':[-15,43],'collision':False,'fields':['careKind','available','activeActorDisplayName if public','lastCareAt','lastActorDisplayName if public','nextEligibleAt'],'fallback':'unavailable when state is unknown; never invent completion'},'actorPolicy':'Keep the actual participant appearance. Qinghe water/clean pose is only for Qinghe herself; do not replace an Agent with the NPC. Shared tool/FX atlas is composited over original participant.'})
routes=[{'routeId':'shade-to-river','name':'树荫到河湾','version':1,'stops':[{'stopId':'pine-shade','name':'松荫漫步园','anchor':point([-14,50]),'arrivalCells':[[-14,50],[-13,50],[-14,49]],'guideRef':'WS03 supplies versioned content'},{'stopId':'river-boardwalk','name':'南汊河湾步道','anchor':point([28,46]),'arrivalCells':[[28,46],[27,46],[28,45]],'guideRef':'WS03 supplies versioned content'}]},{'routeId':'street-stroll','name':'街边慢走','version':1,'stops':[{'stopId':'east-square','name':'东岸外街','anchor':point([76,18]),'arrivalCells':[[76,18],[75,18],[76,19]],'guideRef':'WS03 supplies versioned content'},{'stopId':'tavern-public-edge','name':'港湾酒馆外场','anchor':point([56,14]),'arrivalCells':[[56,14],[55,14],[56,15]],'guideRef':'WS03 supplies versioned content'}]}]
for route in routes:
    route.update({'stopSeconds':30,'physicalCollision':False,'seatReservation':False,'routeIsNotFollowActivity':True,'renderPolicy':'optional navigation pins only when selected; no new permanent sign/furniture'})
pair={'id':'tavern-companion-pair-01','placeId':'harbor_tavern','maxGroups':1,'reservation':'Atomic original two stations + both bodies; no new capacity or meal double-reservation','agent':{'stationId':'harbor_tavern-dining-01',**point([52,16]),'approachCell':[53,16],'facing':'right'},'npc':{'stationId':'harbor_tavern-dining-02',**point([54,16]),'approachCell':[55,16],'facing':'right'},'remainingDiningStationIds':['harbor_tavern-dining-03','harbor_tavern-dining-04'],'originalTotalDiningCapacity':4,'newDiningCapacity':0,'newFurnitureCollision':False,'furniture':'Reuse the original meal-chair at each station. Do not add a table across public aisle. Pose sprites contain no chair.','quiet':'sit-quiet; no cup or tray','topic':'sit-talk only in actual selected topic phase','meal':'tray only during a true self-owned food serving phase; remove after consumption/cancellation','trayBoundsRelativeToNpcFeet':[-16,-24,32,32]}
spatial={'id':'npc-life-spatial-v1','schemaVersion':1,'revision':2,'appendOnlyToMap6':True,'baseMap':{'mapId':'pixel-town-v2','mapManifestVersion':6,'rulesetVersion':6,'topologyVersion':6,'layoutSha256':sha('reference/world-map-expansion-v1.json'),'spatialSha256':sha('reference/spatial-manifest-expansion-v1.json'),'verifiedLiveURL':'http://127.0.0.1:18893/assets/world-life/','verifiedLiveAppVersion':'0.8.0'},'coordinateSystem':{'tileSize':16,'origin':[520,520],'sourceCentreFormula':'520 + cell * 16'},'geometryDelta':{'walkableCellsAdded':[],'walkableCellsRemoved':[],'physicalBlockedCellsAdded':[],'physicalBlockedCellsRemoved':[],'existingStationsModified':[]},'npcs':npcs,'careStations':care,'companionDining':pair,'routes':routes,'rulesOwner':'WS03 01-behaviors.md section 10; numbers copied for reference, server remains authoritative','activation':'design payload only; TD must explicitly activate identities/services/content with its new domain catalog; map6 byte files stay frozen'}
save('spatial-addon-v1.json',spatial)
walk={(x+M['bounds']['minX'],y+M['bounds']['minY']) for y,row in enumerate(M['walkableMask']) for x,v in enumerate(row) if v=='1'}
stations={tuple(c) for p in S['places'] for a in p['stations'] for c in a['cells']}
old_wait={tuple(c) for p in S['places'] for c in p.get('waitingCells',[])}
old_npcs={tuple(n['dutyCell']) for n in S['npcs'] if n.get('dutyCell')}
new_bodies={tuple(n['duty']['cell']) for n in npcs}|{tuple(n['waiting']['cell']) for n in npcs}|{tuple(c['station']['cell']) for c in care}|{tuple(c['waiting']['cell']) for c in care}
new_endpoints=[n[k]['cell'] for n in npcs for k in ['duty','approach','waiting']]+[c[k]['cell'] for c in care for k in ['station','approach','waiting','target']]+[x for r in routes for s in r['stops'] for x in s['arrivalCells']]
assert all(tuple(c) in walk for c in new_endpoints)
assert not new_bodies & (stations|old_wait|old_npcs)
blocked=stations|old_wait|old_npcs|new_bodies
def flood(blocked):
    seen={(0,0)};q=deque(seen)
    while q:
        x,y=q.popleft()
        for p in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
            if p in walk and p not in blocked and p not in seen:seen.add(p);q.append(p)
    return seen
seen=flood(blocked)
ap=[n['approach']['cell'] for n in npcs]+[c['approach']['cell'] for c in care]
assert all(tuple(c) in seen for c in ap)
assert all(any(tuple(c) in seen for c in s['arrivalCells']) for r in routes for s in r['stops'])
assert all(any((x+dx,y+dy) in seen for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]) for x,y in new_bodies)
# Preserve original approachable station entry, excluding already occupied wait/duty cells.
old_approaches={tuple(c) for p in S['places'] for a in p['stations'] for c in a['approachCells']}
assert all(c in seen for c in old_approaches-blocked)
save('spatial-validation.json',{'baseMapLiveBytesMatch':True,'walkableCells':len(walk),'oldStations':len(stations),'newEndpointCoordinatesChecked':len(new_endpoints),'allOnMap6Walkable':True,'newBodiesDisjointOldStationsWaitingDuty':True,'fullOccupancyScenario':{'blockedCells':len(blocked),'reachableFreeCells':len(seen),'allNewApproachesReachable':True,'allFourRouteStopsHaveReachableArrival':True,'newBodiesHaveFreeAdjacentAccess':True,'oldStationApproachesReachable':True},'map6GeometryModified':False,'spatialAddonSha256':sha('spatial-addon-v1.json'),'scope':'static topology and declared simultaneous occupancy; production reservation/permissions/timeouts not tested'})
print('spatial',sha('spatial-addon-v1.json'),'checked',len(new_endpoints),'reachable',len(seen))

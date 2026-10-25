from pathlib import Path
import json,hashlib,copy
from collections import deque
R=Path(__file__).resolve().parent; repo=R.parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
base=repo/'apps/web/public/world-map-life-v1.json';L=json.loads(base.read_text());A=json.loads((repo/'apps/web/public/world-life/spatial-manifest.json').read_text());b=L['bounds']
def cells(l,k):return {(x+b['minX'],y+b['minY']) for y,r in enumerate(l[k]) for x,v in enumerate(r) if v=='1'}
def bfs(allowed,start=(0,0)):
 p={start:None};q=deque([start])
 while q:
  x,y=q.popleft()
  for c in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if c in allowed and c not in p:p[c]=(x,y);q.append(c)
 return p
def path(p,c):
 out=[]
 while c is not None:out.append(list(c));c=p[c]
 return out[::-1]
source=lambda c:[520+16*c[0],520+16*c[1]]
added=[[44,5],[44,7],[44,11],[44,13],[28,17]]
oldwalk=cells(L,'walkableMask');oldphys=cells(L,'physicalBlockedMask');assert len(oldwalk)==1175
for x,y in added:
 assert (x,y) not in oldwalk|oldphys
 for key,bit in [('walkableMask','1'),('blockedMask','0'),('outsideWalkableMask','0')]:
  row=list(L[key][y-b['minY']]);row[x-b['minX']]=bit;L[key][y-b['minY']]=''.join(row)
L['boats'][0].update(cell=[39,18],sourceAnchor=[1144,808])
L['version']='m3-life-b-layout-v1';L['layoutId']='m3-life-b-layout-v1';L['rulesetVersion']=L['topologyVersion']=4
L['proposalOnly']=True;L['productionConnected']=False
L['stats'].update(totalWalkable=1180,addedSinceV1=642,addedWalkable=924,effectiveWalkableRatio=1180/256,outsideWalkable=2830,lifeNpcCount=5,lifeAddedWalkable=30,lifeBAddedWalkable=5)
L['derivation']={'basePath':'/world-map-life-v1.json','baseSha256':sha(base),'change':'5 previously unopened dry exterior cells become walkable: 4 shore seats + 1 shop clerk; preserves all 1175 old walkable and 1622 physical cells, original buildings, water, bridges, docks and stairs; relocate decorative boat-a from [41,12] to [39,18] to clear fishing lines (no collision or service change)','status':'frozen B design candidate, production activation belongs to TD'}
npc={'npcId':'npc-fishing-clerk','name':'渔具店员','role':'渔具店员','anchorBuildingId':'e-stall','dutyPlaceId':'fisher_shop','initialCell':[28,17],'dutyCell':[28,17],'approachCells':[[27,17]],'appearance':{'lookId':'sunnyside-human-spikeyhair','catalogVersion':'2026-10-21.appearance-v1.1','hair':'spikeyhair'},'shortIdPolicy':'allocator_assigns; never hardcode N005','movementSource':'authoritative; duty cell is not a perpetual position','stateAssets':['fishing-cast','fishing-wait','fishing-reel','duty'],'servicePolicy':'fisher_shop remains self-service while clerk is away'}
L['npcServicePoints'].append({'id':npc['npcId'],'name':npc['name'],'role':npc['role'],'buildingId':'e-stall','standingCell':[28,17],'approachCells':[[27,17]],'hair':'spikeyhair','anchor':source([28,17]),'localDemoOnly':False,'serverManagedFuture':True,'productionConnected':False,'occlusion':{'sortY':792,'policy':'authoritative feet y'}})
write('world-map-life-b-v1.json',L)
M=copy.deepcopy(A);M['revision']=2;M['id']='m3-life-b-semantic-v1';M['scope']='A preserved + B fishing and self-service fisher shop; frozen design, not live server state'
M['map'].update(rulesetVersion=4,topologyVersion=4,mapManifestVersion=4,layoutUrl='/world-map-life-b-v1.json',sourceFile='world-map-life-b-v1.json',layoutSha256=sha(R/'world-map-life-b-v1.json'),baseLayoutSha256=sha(base))
M['map']['geometryDigest']='TD runtime converter computes canonical digest; byte SHA is not geometryDigest'
for p in M['places']:p['walkableVersion']=4
M['npcs'].append(npc)
for placeId,spot,name,seats,approaches,entrance,bypass,crop in [
 ('harbor_shore','shore_spot','港区近岸',[[44,5],[44,7],[44,11],[44,13]],[[45,5],[45,7],[45,11],[45,13]],[46,8],[[46,y] for y in range(5,15)],[1140,560,176,208]),
 ('harbor_pier','pier_spot','港湾木栈台',[[41,10],[43,10],[45,10]],[[41,9],[43,9],[45,9]],[46,9],[[x,9] for x in range(41,47)],[1112,624,200,112])]:
  ss=[]
  for i,(seat,ap) in enumerate(zip(seats,approaches),1):
   foot=source(seat);bobber=[foot[0]-30,foot[1]+23];bobbercell=[(bobber[0]-512)//16,(bobber[1]-512)//16]
   ss.append({'id':f'{placeId}-{i:02}','spotId':spot,'actionIds':['fish.session'],'capacity':1,'cells':[seat],'approachCells':[ap],'facing':'left','assetRef':'fishing-wait','visualAnchor':{'cell':seat,'source':foot,'feetPivot':[48,39]},'lineLandingSource':bobber,'lineLandingWaterCell':bobbercell,'lineIsDecorative':True})
  M['places'].append({'placeId':placeId,'parentSceneId':'qingzhou-town','name':name,'anchorBuildingId':'h-warehouse' if spot=='shore_spot' else None,'dockId':'inner-pier' if spot=='pier_spot' else None,'interior':False,'cells':seats+approaches,'entrances':[entrance],'approachCells':approaches,'waitingCells':[],'waitingCapacity':0,'waitingPolicy':'no reserved waiting positions; capacity full returns unavailable; do not idle on bridge or pier aisle','capacity':len(seats),'stations':ss,'walkableVersion':4,'visualAnchor':{'sourceCrop':crop},'occlusionLayer':'native feet y; line behind actor, water splash without collision','assetRefs':['fishing-cast','fishing-wait','fishing-reel','fishing-caught'],'occupancyPolicy':'1 actor per station; only authority assigns/relinquishes occupancy','publicBypassCells':bypass})
M['places'].append({'placeId':'fisher_shop','parentSceneId':'qingzhou-town','name':'渔人小铺','anchorBuildingId':'e-stall','interior':False,'cells':[[27,17],[28,17]],'entrances':[[27,17]],'approachCells':[[27,17]],'waitingCells':[],'waitingCapacity':0,'capacity':None,'stations':[],'walkableVersion':4,'visualAnchor':{'sourceCrop':[900,704,112,112]},'assetRefs':['life-item-basic_rod','life-item-bait','life-item-sardine','life-item-mackerel','life-item-sea_bass'],'publicBypassCells':[[25,17],[26,17],[27,17]],'shopId':'fisher_shop','npcId':'npc-fishing-clerk','shopService':'self-service; only rod/bait for sale; only three fish bought back; no interior and no duplicate building'})
M['preserve'].update(originalWalkableCells=1175,physicalBlockedCells=1622,buildingEntrances=31,lifeAStationIdsUnchanged=True)
M['deferred']=['C four remaining item images and librarian/neighbor NPCs; not part of B activation']
write('spatial-manifest.json',M)
W=cells(L,'walkableMask');P=cells(L,'physicalBlockedMask');U=cells(L,'outsideWalkableMask');assert W-oldwalk==set(map(tuple,added));assert P==oldphys;assert not W&P and not W&U and not P&U;assert len(W|P|U)==88*64
water={tuple(w['cell']) for w in L['water']};dock={tuple(c) for d in L['docks'] for c in d['deckCells']}
assert not set(map(tuple,added))&water
aseats={tuple(c) for p in A['places'] for s in p['stations'] for c in s['cells']};awaits={tuple(c) for p in A['places'] for c in p['waitingCells']};bstations=[s for p in M['places'][3:5] for s in p['stations']];bseats={tuple(s['cells'][0]) for s in bstations};occ=aseats|awaits|bseats|{(28,17)}
assert len(bseats)==7 and not bseats&(aseats|awaits);parent=bfs(W-occ);baseline=bfs(oldwalk-(aseats|awaits));assert set(baseline)-bseats<=parent.keys(), sorted(set(baseline)-bseats-parent.keys())
entrances={b['id']:b['entrance']['cell'] for b in L['buildings']};assert len(entrances)==31 and all(tuple(c) in parent for c in entrances.values())
routes=[]
for s in bstations:
 seat=tuple(s['cells'][0]);ap=tuple(s['approachCells'][0]);assert seat in W and ap in parent and abs(seat[0]-ap[0])+abs(seat[1]-ap[1])==1;assert seat in bfs(W-(occ-{seat}));assert tuple(s['lineLandingWaterCell']) in water-dock
 routes.append({'stationId':s['id'],'seat':list(seat),'source':s['visualAnchor']['source'],'approach':list(ap),'water':s['lineLandingWaterCell'],'pathToApproachWhenAllAAndBSeatsOccupied':path(parent,ap)})
for p in M['places'][3:]:
 for c in p['publicBypassCells']+p['entrances']:assert tuple(c) in parent,(p['placeId'],c)
for key in ['buildings','physicalBlocked','props','water','bridges','docks','stairs','retainingWalls','garden']:assert L[key]==json.loads(base.read_text())[key]
write('geometry-delta.json',{'baseFile':'apps/web/public/world-map-life-v1.json','baseSha256':sha(base),'newFile':'world-map-life-b-v1.json','newSha256':sha(R/'world-map-life-b-v1.json'),'addedWalkable':added,'oldWalkable':1175,'newWalkable':1180,'physicalBlockedUnchanged':1622,'unopened':2830,'decorativeBoatRelocation':{'id':'boat-a','fromCell':[41,12],'toCell':[39,18],'fromSource':[1176,712],'toSource':[1144,808]},'rulesetVersion':4,'topologyVersion':4})
write('spatial-validation.json',{'status':'PASS','scope':'offline exact map occupancy/reachability, not runtime integration','counts':{'oldWalkable':1175,'walkable':1180,'newDryCells':5,'physicalBlocked':1622,'unopened':2830,'reachableBuildingEntrances':31,'newFishingStations':7,'preservedAStations':len(aseats),'preservedAWaiting':len(awaits)},'allASeatsWaitingPlusBSeatsAndClerkOccupied':True,'additionalDisconnectedPreviouslyReachablePublicCells':0,'alreadyIsolatedByFullAOccupancy':sorted(map(list,oldwalk-(aseats|awaits)-set(baseline))),'waterLandingChecks':7,'stationRoutes':routes,'shopApproachRoute':path(parent,(27,17)),'limits':['No production map activated','No money/items/activity created','Dynamic crowd and active-path transition tests belong to engineering']})
print(json.dumps({'layoutSha256':sha(R/'world-map-life-b-v1.json'),'spatialSha256':sha(R/'spatial-manifest.json'),'stations':[(s['id'],s['cells'],s['lineLandingWaterCell']) for s in bstations],'reachableEntrances':31},ensure_ascii=False))

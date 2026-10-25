from pathlib import Path
import json,hashlib,copy
from collections import deque
R=Path(__file__).resolve().parent;B=R.parent/'m3-life-b-20261025'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
base=B/'world-map-life-b-v1.json';L=json.loads(base.read_text());M=json.loads((B/'spatial-manifest.json').read_text());old=copy.deepcopy(L);oldM=copy.deepcopy(M);b=L['bounds'];source=lambda c:[520+16*c[0],520+16*c[1]]
def cells(l,k):return {(x+b['minX'],y+b['minY']) for y,row in enumerate(l[k]) for x,v in enumerate(row) if v=='1'}
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
oldW=cells(L,'walkableMask');oldP=cells(L,'physicalBlockedMask');water={tuple(w['cell']) for w in L['water']}
inn=[[x,5] for x in range(21,25)];read=[[x,-10] for x in range(18,22)];dining=[[52,16],[54,16],[52,18],[54,18]];kitchen=[[55,13],[56,13]]
newFloor={tuple(c) for c in inn+read+dining+kitchen}|{(24,4),(21,-3)}|{(x,-11) for x in range(18,22)}|{(x,y) for x in range(52,57) for y in range(12,19) if (x,y) not in oldP}
added=sorted(newFloor-oldW,key=lambda p:(p[1],p[0]));assert not set(added)&(oldP|water)
for x,y in added:
 for k,bit in [('walkableMask','1'),('blockedMask','0'),('outsideWalkableMask','0')]:row=list(L[k][y-b['minY']]);row[x-b['minX']]=bit;L[k][y-b['minY']]=''.join(row)
npcs=[{'npcId':'npc-librarian','name':'书屋管理员','role':'书屋管理员','anchorBuildingId':'n-blue','dutyPlaceId':'blue_library','initialCell':[21,-3],'dutyCell':[21,-3],'approachCells':[[21,-2]],'appearance':{'lookId':'sunnyside-human-mophair','catalogVersion':'2026-10-21.appearance-v1.1','hair':'mophair','hairColorId':'ash','clothingColorId':'cream'},'shortIdPolicy':'allocator assigns; no fixed N006','movementSource':'authoritative state; duty is not a fixed current position'}, {'npcId':'npc-neighbor','name':'自由镇民','role':'自由镇民','anchorBuildingId':None,'dutyPlaceId':None,'initialCell':[14,2],'dutyCell':None,'approachCells':[[14,3]],'appearance':{'lookId':'sunnyside-human-longhair','catalogVersion':'2026-10-21.appearance-v1.1','hair':'longhair','hairColorId':'ink','clothingColorId':'forest'},'shortIdPolicy':'allocator assigns; no fixed N007','movementSource':'authoritative state; no duty candidate for a resident without dutyPlace'}]
for n in npcs:L['npcServicePoints'].append({'id':n['npcId'],'name':n['name'],'role':n['role'],'buildingId':n['anchorBuildingId'],'standingCell':n['initialCell'],'approachCells':n['approachCells'],'hair':n['appearance']['hair'],'appearanceColors':{k:n['appearance'][k] for k in ['hairColorId','clothingColorId']},'anchor':source(n['initialCell']),'localDemoOnly':False,'serverManagedFuture':True,'productionConnected':False})
L['version']=L['layoutId']='m3-life-c-layout-v1';L['rulesetVersion']=L['topologyVersion']=5
count=1180+len(added);L['stats'].update(totalWalkable=count,addedSinceV1=count-538,addedWalkable=count-256,effectiveWalkableRatio=count/256,outsideWalkable=2830-len(added),lifeNpcCount=7,lifeAddedWalkable=count-1150,lifeCAddedWalkable=len(added));L['derivation']={'basePath':'/world-map-life-b-v1.json','baseSha256':sha(base),'change':f'{len(added)} unopened dry cells become walkable for inn porch, library reading porch, tavern dining/kitchen and librarian; preserves every B walkable and physical cell, every building/water/bridge/stair/dock/boat','status':'frozen C design candidate; not deployed'};write('world-map-life-c-v1.json',L)
M['revision']=3;M['id']='m3-life-c-semantic-v1';M['scope']='A+B preserved; C inn/shared voucher rest, dining/kitchen, reading, visits and two NPCs; design only';M['map'].update(rulesetVersion=5,topologyVersion=5,mapManifestVersion=5,layoutUrl='/world-map-life-c-v1.json',sourceFile='world-map-life-c-v1.json',layoutSha256=sha(R/'world-map-life-c-v1.json'),baseLayoutSha256=sha(base));M['npcs']+=npcs
for p in M['places']:p['walkableVersion']=5
M['places'][2]['stations']=[{**s,'actionIds':s['actionIds']+['meal.eat']} for s in M['places'][2]['stations']]
def stations(prefix,seats,approaches,actions,asset,group):
 return [{'id':f'{prefix}-{i+1:02}','actionIds':actions,'capacity':1,'cells':[seat],'approachCells':[approaches[i]],'facing':'right','assetRef':asset,'stationGroup':group,'visualAnchor':{'cell':seat,'source':source(seat),'feetPivot':[48,39]}} for i,seat in enumerate(seats)]
def place(id,name,building,seats,approaches,actions,asset,group,crop):
 return {'placeId':id,'parentSceneId':'qingzhou-town','name':name,'anchorBuildingId':building,'interior':False,'cells':seats+approaches,'entrances':[approaches[0]],'approachCells':approaches,'waitingCells':[],'waitingCapacity':0,'capacity':len(seats),'stations':stations(id,seats,approaches,actions,asset,group),'walkableVersion':5,'visualAnchor':{'sourceCrop':crop},'occlusionLayer':'chair back / whole approved native seated person / prop; shelter roof separate, never hide face','assetRefs':[asset],'publicBypassCells':approaches,'occupancyPolicy':'authority only; no instant transfer to seat'}
pi=place('stone_inn','石岸旅舍·西侧休憩廊','e-inn',inn,[[x,4] for x in range(21,25)],['rest.inn'],'rest-chair','rest',[800,528,240,144]);pi['sharedCapacityKey']='stone_inn-rest';pi['legacyServiceId']='inn.rest';pi['legacyOperationIds']=['town_services.inn.rest.start','town_services.inn.rest.cancel'];pi['legacyVoucherMapping']='old inn voucher and new paid rest share these same four physical stations; not four extra beds';pi['shelter']={'asset':'canopy-inn','sourceAnchor':[884,600]};M['places'].append(pi)
pl=place('blue_library','蓝檐书屋·北侧阅读廊','n-blue',read,[[x,-11] for x in range(18,22)],['book.read'],'read-chair','reading',[736,288,176,208]);pl['shelter']={'asset':'canopy-library','sourceAnchor':[832,360]};pl['bookPurchaseApproach']=[20,-3];pl['libraryDutyCell']=[21,-3];M['places'].append(pl)
tav=M['places'][1];tav['stations']+=stations('harbor_tavern-dining',dining,[[53,16],[55,16],[53,18],[55,18]],['meal.eat'],'meal-chair','dining')+stations('harbor_tavern-kitchen',kitchen,[[55,12],[56,12]],['meal.prepare'],'kitchen-counter','kitchen');tav['capacity']=None;tav['capacityByStation']={'work':3,'dining':4,'kitchen':2};tav['publicBypassCells']+= [[52,12],[52,13],[52,14],[52,15],[53,15],[53,16],[53,17],[53,18],[55,12],[56,12],[55,15],[55,16],[55,17],[55,18]];tav['cells']+=dining+kitchen+tav['publicBypassCells'];tav['shopPurchaseApproach']=[54,12];tav['assetRefs']+=['meal-chair','kitchen-counter','life-item-bread_meal','life-item-herbal_tea','life-item-grilled_fish'];tav['visualAnchor']={'sourceCrop':[1256,624,240,224]}
M['places'].append({'placeId':'lookout','name':'穹顶观测台外侧','parentSceneId':'qingzhou-town','anchorBuildingId':'p-observatory','interior':False,'cells':[[18,-23]],'entrances':[[18,-23]],'approachCells':[[18,-22]],'capacity':None,'stations':[],'waitingCells':[],'waitingCapacity':0,'walkableVersion':5,'actionIds':['visit.place'],'assetRefs':[],'publicBypassCells':[],'visitPolicy':'30s public exterior visit; no telescope or indoor service'})
M['preserve'].update(originalWalkableCells=1180,lifeBStationIdsUnchanged=True);M['deferred']=[];write('spatial-manifest.json',M)
W=cells(L,'walkableMask');P=cells(L,'physicalBlockedMask');U=cells(L,'outsideWalkableMask');assert W-oldW==set(added) and oldW<=W and P==oldP;assert len(W|P|U)==88*64 and not W&P and not W&U
for k in ['bounds','origin','buildings','props','physicalBlocked','water','bridges','docks','stairs','retainingWalls','boats']:assert L[k]==old[k]
oldSeats={tuple(c) for p in oldM['places'] for s in p['stations'] for c in s['cells']};wait={tuple(c) for p in oldM['places'] for c in p['waitingCells']};oldOcc=oldSeats|wait|{(28,17)};allSeats=[s for p in M['places'] for s in p['stations']];seatCells=[tuple(c) for s in allSeats for c in s['cells']];assert len(seatCells)==len(set(seatCells))==34
occ=set(seatCells)|wait|{(28,17),(21,-3)};baseline=bfs(oldW-oldOcc);parent=bfs(W-occ);assert set(baseline)-occ<=parent.keys(),sorted(set(baseline)-occ-parent.keys())
assert all(tuple(x['entrance']['cell']) in parent for x in L['buildings'])
newStations=[s for s in allSeats if tuple(s['cells'][0]) not in oldSeats];routes=[]
for s in newStations:
 seat=tuple(s['cells'][0]);ap=tuple(s['approachCells'][0]);assert seat in bfs(W-(occ-{seat})) and ap in parent;assert abs(seat[0]-ap[0])+abs(seat[1]-ap[1])==1;routes.append({'stationId':s['id'],'seat':list(seat),'approach':list(ap),'pathWhenAllSeatsOccupied':path(parent,ap)})
for p in M['places']:
 for c in p.get('publicBypassCells',[]):assert tuple(c) in parent,(p['placeId'],c)
assert (21,-2) in parent and (14,2) in W
write('geometry-delta.json',{'baseFile':'../m3-life-b-20261025/world-map-life-b-v1.json','baseSha256':sha(base),'newFile':'world-map-life-c-v1.json','newSha256':sha(R/'world-map-life-c-v1.json'),'addedWalkable':list(map(list,added)),'counts':{'before':1180,'after':count,'physicalBlocked':1622,'unopened':2830-len(added)},'rulesetVersion':5,'topologyVersion':5})
write('spatial-validation.json',{'status':'PASS','scope':'offline exact C candidate map; not production acceptance','counts':{'preservedBWalkable':1180,'addedDryCells':len(added),'walkable':count,'physicalUnchanged':1622,'newStations':14,'totalA_B_CStations':34,'reachableBuildingEntrances':31},'allSeatsAndAWaitingAndClerkAndLibrarianOccupied':True,'additionalDisconnectedPreviouslyReachablePublicCells':0,'stationRoutes':routes,'allSevenNpcInitialsWalkable':all(tuple(n['initialCell']) in W for n in M['npcs']),'limits':['No production rules or DB changed','No meal/rest/read/gift transactions executed','Legacy voucher capacity and migration require engineering tests']})
print({'added':len(added),'walkable':count,'layoutSha':sha(R/'world-map-life-c-v1.json'),'spatialSha':sha(R/'spatial-manifest.json'),'newStations':len(newStations)})

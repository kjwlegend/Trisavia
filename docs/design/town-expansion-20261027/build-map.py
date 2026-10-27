"""Reproducible design export from the exact 0.7.3 Life C layout; no runtime writes."""
from pathlib import Path
from collections import deque
import json, copy, hashlib
R=Path(__file__).resolve().parent
BASE=R.parent/'m3-life-c-20261025'
def read(p):return json.loads(p.read_text())
def write(n,v):(R/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base=BASE/'world-map-life-c-v1.json';old=read(base);L=copy.deepcopy(old);M=read(BASE/'spatial-manifest.json');oldB=old['bounds'];B={'minX':-28,'minY':-28,'maxX':91,'maxY':59}
def maskcells(l,k):
 b=l['bounds'];return {(x+b['minX'],y+b['minY']) for y,row in enumerate(l[k]) for x,v in enumerate(row) if v=='1'}
def inside(c):return B['minX']<=c[0]<=B['maxX'] and B['minY']<=c[1]<=B['maxY']
def source(c):return [520+16*c[0],520+16*c[1]]
def rect(x1,y1,x2,y2):return {(x,y) for y in range(y1,y2+1) for x in range(x1,x2+1)}
def bfs(w,start=(0,0)):
 p={start:None};q=deque([start])
 while q:
  x,y=q.popleft()
  for c in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
   if c in w and c not in p:p[c]=(x,y);q.append(c)
 return p
def route(p,c):
 a=[]
 while c is not None:a.append(list(c));c=p[c]
 return a[::-1]
assert sha(base)=='c025fbdce5cd5fba4a33c1013fb6a49847be55a68c7c12edcdaa0a37524d7b08'
assert sha(BASE/'spatial-manifest.json')=='e30e46f7a6d66315b11af0eb7896908e84e5a70af0a0bfe72006fbbb8199152a'
oldW=maskcells(old,'walkableMask');oldP=maskcells(old,'physicalBlockedMask');W=set(oldW);P=set(oldP);water={tuple(r['cell']) for r in L['water']};oldWater=set(water)
# Extend the same river south, and let the broad northern bay continue to the new image edge.
for y in range(40,64):
 left=31+((y-40)//7)%2;right=39+((y-40)//8)%2
 water|=rect(left,y,right,y)
for x in range(64,96):
 bottom=-29+((x-64)//5)*2
 water|=rect(x,-32,x,bottom)
for c in sorted(water-oldWater,key=lambda a:(a[1],a[0])):L['water'].append({'cell':list(c),'source':[source(c)[0]-8,source(c)[1]-8]})
# Old water that was previously beyond the logical map now gains authoritative blocking.
newWaterP={c for c in water if inside(c) and c not in oldW}-P
for c in sorted(newWaterP,key=lambda a:(a[1],a[0])):L['physicalBlocked'].append({'cell':list(c),'category':'water','id':'river-expansion'})
P|=newWaterP
surfaces={};zoneCells={}
def add(r,s='path',zone=None):
 assert not r&P,('route_hits_solid',sorted(r&P));W.update(r)
 for c in r:
  if c not in oldW:surfaces[c]=s
 if zone:zoneCells.setdefault(zone,set()).update(r)
# Woodland loop with two entrances, a grassy clearing and a broad east connection.
add(rect(-24,35,-23,41),zone='pine-walk')
for r in [rect(-24,40,-20,41),rect(-21,41,-20,52),rect(-20,52,-17,53),rect(-17,53,-1,54),rect(-1,49,0,53),rect(-3,40,-2,49),rect(-20,40,-2,41),rect(-20,47,-2,48)]:add(r,zone='pine-walk')
add(rect(-18,43,-5,50),'grass','pine-walk')
add(rect(-4,48,19,49),zone='river-walk')
# South bank promenade: each side remains on dry land; deck is a land boardwalk.
add(rect(18,29,19,54),zone='river-walk')
for r in [rect(19,53,27,54),rect(26,38,27,53),rect(19,38,27,39),rect(19,44,27,45)]:add(r,zone='river-walk')
add(rect(26,43,29,49),'wood','river-walk')
add(rect(21,40,24,51),'grass','river-walk')
# East street has a north/south loop, a small paved square, and two old-town entries.
add(rect(57,12,66,12),'path','east-street');add(rect(59,13,66,13),'path','east-street')
add(rect(56,28,83,29),'path','east-street')
for r in [rect(65,8,66,29),rect(65,8,82,9),rect(82,9,83,29),rect(66,18,82,19)]:add(r,'cobble','east-street')
add(rect(70,15,78,23),'cobble','east-street')
# Place only native decorations, outside every old collision and new walking cell.
newProps=[]
def prop(t,x,y,tag):
 c=(x,y)
 if c in W or c in P or c in water or not inside(c):return False
 pid=f'exp-{tag}-{len(newProps):03}';p={'id':pid,'type':t,'cell':[x,y],'groundAnchor':source(c),'occlusion':{'sortY':source(c)[1],'policy':'groundAnchorY'},'expansion':True};L['props'].append(p);newProps.append(p);P.add(c);L['physicalBlocked'].append({'cell':[x,y],'category':'treeRoot' if t.startswith('tree') else 'fixture','id':pid});return True
# Loose forest outline; keep crowns away from traversable paths, not a solid rectangular hedge.
for cx,cy,kind in [(-25,39,'treePine'),(-25,47,'treePine'),(-22,56,'treeOak'),(-13,57,'treeOak'),(-5,57,'treePine'),(3,54,'treePine'),(4,42,'treeOak'),(-12,38,'treePine'),(-6,38,'treeOak'),(10,40,'treeOak'),(9,53,'treePine'),(23,56,'treeOak'),(16,36,'treeOak'),(23,35,'treePine'),(29,37,'treeOak'),(61,6,'treePine'),(73,5,'treeOak'),(86,7,'treePine'),(87,16,'treeOak'),(87,25,'treePine'),(75,33,'treeOak'),(63,33,'treePine'),(62,20,'treeOak')]:
 for dx,dy in [(0,0),(-1,1),(1,1),(0,2)]:
  c=(cx+dx,cy+dy)
  # A 2-cell visual clearance from all paths prevents tree crowns hiding the route.
  if min((abs(c[0]-w[0])+abs(c[1]-w[1]) for w in W),default=99)>2:prop(kind,*c,'grove')
for x,y in [(-23,38),(-18,51),(-3,46),(2,50),(17,36),(25,41),(25,51),(60,27),(64,10),(81,15),(81,25),(79,22)]:prop('lamp',x,y,'lamp')
for x,y in [(-22,42),(-4,41),(20,38),(25,54),(63,12),(68,28),(80,8)]:prop('signpost',x,y,'sign')
for x,y in [(69,15),(69,17),(79,17),(79,19),(69,23),(79,23),(-19,42),(-4,50),(24,39)]:prop('planter',x,y,'planter')
for x,y in [(70,25),(71,25),(76,11),(77,11)]:prop('crates',x,y,'crates')
for x,y in [(72,25),(78,11),(-16,39),(23,37)]:prop('barrel',x,y,'barrel')
for x,y in [(-25,51),(-2,56),(11,43),(12,54),(85,31),(60,23)]:prop('rock',x,y,'rock')
for x,y in [(71,14),(72,14),(73,14),(75,24),(76,24),(77,24),(28,41),(29,41)]:prop('fenceHorizontal',x,y,'fence')
# No rendering helper is required: all assets/surfaces are understood by current native renderer.
for c,s in sorted(surfaces.items(),key=lambda a:(a[0][1],a[0][0])):
 if s!='grass':L['roadCells'].append({'cell':list(c),'kind':'expansion-lane','surface':s,'expansion':True})
regions=[
 {'id':'pine-walk','name':'松荫漫步园','polygon':[[72,1128],[616,1128],[616,1432],[72,1432]],'color':'#70865e','focus':source([-11,47]),'roamTargets':[[-17,44],[-7,46],[-14,50],[-3,48]],'connections':[[-24,34],[-23,34]],'description':'树荫小径围合一片草地，东侧步行接入河湾。'},
 {'id':'river-walk','name':'南汊河湾步道','polygon':[[616,1096],[1000,1096],[1000,1432],[616,1432]],'color':'#557f7d','focus':source([23,46]),'roamTargets':[[18,41],[23,45],[28,46],[24,54]],'connections':[[18,28],[19,28],[-3,48]],'description':'沿河木步道与草地小径组成环线，保留完整水岸。'},
 {'id':'east-street','name':'东岸外街','polygon':[[1456,600],[1952,600],[1952,1056],[1456,1056]],'color':'#a37c50','focus':source([74,19]),'roamTargets':[[66,10],[74,18],[82,24],[74,28]],'connections':[[55,28],[56,12]],'description':'石铺小广场、花箱与临街树带，双入口连接旧港湾。'}]
for r in regions:L['districts'].append({**r,'newRegion':True,'roamTarget':r['roamTargets'][0],'labelAnchor':[r['focus'][0],r['focus'][1]-75],'walkOnly':True})
L['bounds']=B;L['source'].update(width=2048,height=1536,sourceAreaRatio=8);L['version']=L['layoutId']='town-expansion-layout-v1';L['rulesetVersion']=L['topologyVersion']=6;L['proposalOnly']=True;L['productionConnected']=False
allCells=rect(B['minX'],B['minY'],B['maxX'],B['maxY']);U=allCells-W-P
assert W<=allCells and P<=allCells
for k,cells in [('walkableMask',W),('blockedMask',allCells-W),('physicalBlockedMask',P),('outsideWalkableMask',U)]:L[k]=[''.join('1' if (x,y) in cells else '0' for x in range(B['minX'],B['maxX']+1)) for y in range(B['minY'],B['maxY']+1)]
inherited=maskcells(old,'v1InheritedMask')
L['v1InheritedMask']=[''.join('1' if (x,y) in inherited else '0' for x in range(B['minX'],B['maxX']+1)) for y in range(B['minY'],B['maxY']+1)]
L['maskEncoding'].update(columns=120,rows=88,walkableMeaning='exterior walkable cells for rules/topology 6; authoritative only when server activates this exact artifact')
L['ground']['waterSource']='water[] is authoritative; riverRows is a visual index only'
L['ground'].pop('riverColumnBySourceRow',None)
riverRows=[]
for y in range(-32,64):
 xs=sorted(x for x,wy in water if wy==y);ranges=[]
 for x in xs:
  if not ranges or x>ranges[-1][1]+1:ranges.append([x,x])
  else:ranges[-1][1]=x
 if xs:riverRows.append({'sourceY':512+16*y,'minX':xs[0],'maxX':xs[-1],'spans':ranges})
L['ground']['riverRows']=riverRows
L['localRoaming']={'previewOnly':True,'realAgent':False,'pathfinding':'orthogonal on walkableMask','pathPolicy':'validation routes are reachability proofs, not single movement commands; A consumes current movement path limit and replans from authoritative current position'}
L['stats'].update(totalWalkable=len(W),addedSinceV1=len(W)-538,addedWalkable=len(W)-256,effectiveWalkableRatio=len(W)/256,physicalBlocked=len(P),outsideWalkable=len(U),expansionAddedWalkable=len(W-oldW),expansionAddedProps=len(newProps));L['derivation']={'baseCommit':'6a8f8bd566f6fef3ebe206f3a5db404eb0f53955','basePath':'apps/web/public/world-life/world-map-life-c-v1.json','baseSha256':sha(base),'change':'three continuous dry-land public walking extensions; existing coordinates, facts, services and water preserved','status':'design candidate, not deployed'}
write('world-map-expansion-v1.json',L)
M['revision']=4;M['id']='town-expansion-semantic-v1';M['scope']='Life A+B+C unchanged; three public walking regions only';M['map'].update(rulesetVersion=6,topologyVersion=6,mapManifestVersion=6,layoutUrl='/world-map-expansion-v1.json',sourceFile='world-map-expansion-v1.json',layoutSha256=sha(R/'world-map-expansion-v1.json'),baseLayoutSha256=sha(base),sourceSize=[2048,1536],bounds=B)
for p in M['places']:p['walkableVersion']=6
M['publicWalkingRegions']=[{**r,'parentSceneId':'qingzhou-town','interior':False,'serviceIds':[],'stationIds':[],'capacity':None} for r in regions];M['preserve']['lifeCStationsUnchanged']=True;write('spatial-manifest.json',M)
# Minimal honest topology validation, including occupied old station+waiting scenarios.
seats={tuple(c) for p in M['places'] for s in p['stations'] for c in s['cells']};wait={tuple(c) for p in M['places'] for c in p.get('waitingCells',[])};npcDuty={(28,17),(21,-3)};occ=seats|wait|npcDuty;parent=bfs(W-occ);before=bfs(oldW-occ)
assert not W&P and not W&U and not P&U and len(W|P|U)==120*88
assert oldW<=W and oldP<=P and oldWater<=water
for k in ['origin','buildings','bridges','docks','boats','stairs','retainingWalls','npcServicePoints','terrace','garden','commons']:assert L[k]==old[k],k
assert L['props'][:len(old['props'])]==old['props'];assert L['roadCells'][:len(old['roadCells'])]==old['roadCells']
assert set(before)<=set(parent)
assert W-oldW<=set(parent)
assert all(tuple(b['entrance']['cell']) in parent for b in L['buildings'])
paths=[]
for r in regions:
 for c in r['roamTargets']:
  assert tuple(c) in parent;paths.append({'regionId':r['id'],'target':c,'source':source(c),'route':route(parent,tuple(c))})
coasts=[]
for x,y in sorted(water,key=lambda a:(a[1],a[0])):
 if not inside((x,y)):continue
 for dx,dy in [(0,-1),(1,0),(0,1),(-1,0)]:
  c=(x+dx,y+dy)
  if inside(c) and c not in water:coasts.append({'waterCell':[x,y],'landCell':list(c),'landWalkable':c in W})
write('geometry-delta.json',{'baseSha256':sha(base),'layoutSha256':sha(R/'world-map-expansion-v1.json'),'addedWalkable':sorted(map(list,W-oldW),key=lambda c:(c[1],c[0])),'addedPhysicalBlocked':sorted(map(list,P-oldP),key=lambda c:(c[1],c[0])),'waterAdded':sorted(map(list,water-oldWater),key=lambda c:(c[1],c[0])),'newPropIds':[p['id'] for p in newProps]})
write('coastline.json',{'coordinateSystem':'logical cells; cardinal bank adjacency, not extra walk permission','edges':coasts})
write('validation.json',{'status':'PASS','scope':'offline design topology, not production acceptance','baseCommit':L['derivation']['baseCommit'],'counts':{'oldWalkable':len(oldW),'newWalkable':len(W),'addedWalkable':len(W-oldW),'oldPhysicalPreserved':len(oldP),'physical':len(P),'unopened':len(U),'newProps':len(newProps),'oldBuildings':31,'oldStations':len(seats),'newPublicTargets':len(paths)},'checks':{'allAddedWalkableReachable':True,'all31BuildingEntrancesReachableWithOldStationsOccupied':True,'everyOldWalkablePhysicalWaterPreserved':True,'noAdditionalDisconnectedOldPublicCell':True,'newTargetsReachableWith34OldStationsWaitingClerkLibrarianOccupied':True,'noServiceOrStationAdded':True},'routes':paths,'limits':['No runtime integration, real Agent movement or speed tested','No new rest/collect/fish/service command or semantic capacity','Original isolated old cells remain unchanged; no global all-map connectivity claim']})
print(json.dumps({'counts':L['stats'],'layoutSha256':sha(R/'world-map-expansion-v1.json'),'spatialSha256':sha(R/'spatial-manifest.json')},ensure_ascii=False))

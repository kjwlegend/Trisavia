from pathlib import Path
import json, hashlib
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
L=json.loads((REPO/'apps/web/public/world-map-life-v1.json').read_text())
lights=[]
for i,p in enumerate([p for p in L['props'] if p['type']=='lamp']):
 lights.append({'id':f'existing-lamp-{i+1:02}','sourcePropId':p['id'],'kind':'existing-street','groundAnchor':p['groundAnchor'],'emitterOffset':[0,-20],'radius':56,'clearance':0.64,'warmAlpha':0.10,'purpose':'保留原有街灯，重复旧ID以坐标识别'})
for ident,kind,xy,r,reason in [
 ('commons-nw','verge',[496,496],60,'公共庭西北交叉口'),('commons-ne','verge',[784,496],60,'公共庭东北交叉口'),('commons-se','verge',[784,784],60,'公共庭东南交叉口'),
 ('west-workshop','wall',[330,582],42,'木作工坊门侧'),('west-bakery','wall',[330,710],42,'麦香炉屋门侧'),('market','wall',[862,566],42,'杂货铺门侧'),
 ('bridge-north-west','verge',[974,514],62,'北汊木桥西桥头；东桥头由原港区灯覆盖'),('bridge-south-west','verge',[974,950],62,'南汊石桥西桥头'),('bridge-south-east','verge',[1238,950],62,'南汊石桥东桥头'),
 ('pier-approach','verge',[1268,672],58,'木栈台岸侧入口，不站在栈桥通行中线'),('warehouse-door','wall',[1294,532],42,'仓棚门侧'),('tavern-door','wall',[1376,694],44,'港湾酒馆门侧'),('inn-door','wall',[948,628],44,'石岸旅舍门侧'),('fisher-door','wall',[970,774],44,'渔人小铺门侧'),
 ('hall-door','wall',[574,230],46,'山台会馆门侧'),('library-door','wall',[860,454],42,'蓝檐书屋门侧'),('garden-pavilion','wall',[176,934],44,'花径凉亭檐下'),
 ('plateau-stairs-east','verge',[814,352],60,'双幅石阶东侧'),('plateau-stairs-west','verge',[392,360],60,'林边缓阶西侧')]:
 lights.append({'id':ident,'kind':kind,'groundAnchor':xy,'emitterOffset':[0,0] if kind=='wall' else [0,-20],'radius':r,'clearance':0.68 if 'bridge' in ident else 0.62,'warmAlpha':0.14 if kind=='wall' else 0.10,'purpose':reason})
spec={'id':'m3-b-night-lighting-v1','coordinateSpace':'Town3 source pixels; not grid cells','sourceSize':[1536,1152],'layoutSource':'apps/web/public/world-map-life-v1.json','layoutSha256':hashlib.sha256((REPO/'apps/web/public/world-map-life-v1.json').read_bytes()).hexdigest(),'worldMapping':{'origin':[520,520],'cellSize':16},'palette':{'night':{'color':[12,20,38],'opacity':0.70,'people':1.12},'day':'unchanged','dusk':'unchanged'},'lightModel':{'warmColor':'#ffd18a','coreColor':'#ffe6b3','darknessFloor':0.20,'coreSize':[4,3],'falloffStops':[[0,1],[0.28,0.72],[0.65,0.22],[1,0]],'flicker':False},'cache':{'resolution':[768,576],'layers':['darkness-mask','warm-tint'],'rgbaBytesTotal':768*576*4*2,'buildWhen':'layout/light manifest or theme changes only','perFrame':'at most 2 cached drawImage calls + small emitter cores; no gradients/blur/readback','dispose':'clear both caches on town teardown; no time-based reallocation','hud':'not affected'},'lights':lights,'placementPolicy':'decorative light fixtures only; do not edit world masks, collisions, walkable version or station capacity; wall lights do not create posts in paths'}
(ROOT/'night-lights.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')

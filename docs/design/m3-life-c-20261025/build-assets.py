from pathlib import Path
import json,hashlib,struct
R=Path(__file__).resolve().parent; repo=R.parents[2]
def desc(p):
 b=p.read_bytes();d={'path':str(p.relative_to(R)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 if p.suffix=='.png':d['size']=list(struct.unpack('>II',b[16:24]))
 return d
items=[('bread_meal','麦香便餐','Bread roll and slice on cream plate',6,60,20),('herbal_tea','草本茶','Sage cup with leaf and steam',3,30,8),('grilled_fish','香煎鱼餐','Cooked golden fish fillet and greens on plate',None,60,28),('harbor_handbook','港湾生活手册','Sea-green handbook with wave and ribbon',10,None,None)]
M={'id':'m3-life-c-assets-v1','version':'1.0.0','catalogRevision':1,'designOnly':True,'items':[],'atlas':desc(R/'assets/items/items-atlas.png'),'itemStyle':{'logicalSize':[32,32],'marginMin':3,'alpha':True,'displaySizes':[32,64,128],'sampling':'nearest','tool':'built-in image_gen','prompts':'prompts/','technicalExport':'image-export.json'},'fixtures':[],'actors':[],'poses':[],'nativeExport':'native-export.json','sourcePolicy':'Native original PNGs unchanged; existing finite appearance-palette.js render and A seated pose composition. New SVG fixtures extend existing native pixel shape style. Do not substitute human body for a custom non-human avatar.'}
for i,(id,name,alt,price,time,gain)in enumerate(items):M['items'].append({'assetId':'life-item-'+id,'itemId':id,'name':name,'alt':alt,'sprite':desc(R/f'assets/items/{id}.png'),'frame':[i*32,0,32,32],'pivot':[16,16],'master':desc(R/f'assets/generated/{id}.png'),'prompt':f'prompts/{id}.txt','source':'Built-in image_gen created for this project','catalogReferenceOnly':{'buyPrice':price,'durationSeconds':time,'energyGain':gain}})
for f in json.loads((R/'native-export.json').read_text())['files']:
 d={**f,**desc(R/f['path'])}
 if '/fixtures/'in f['path']:M['fixtures'].append(d)
 elif '/actors/'in f['path']:M['actors'].append(d)
 else:M['poses'].append(d)
M['fixturePlacement']=[{'asset':'canopy-inn','source':[884,600],'imageOffset':[-40,-46],'size':[80,50]},{'asset':'canopy-library','source':[832,360],'imageOffset':[-40,-46],'size':[80,50]},{'asset':'kitchen-counter','source':[1408,725],'imageOffset':[-24,-20],'size':[48,20]}]
M['sourceFiles']=[{'path':str(p.relative_to(repo)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in [repo/'apps/web/public/world-pixel/appearance-palette.js',repo/'apps/web/public/world-pixel/appearance-colors-v1.json',R.parent/'m3-life-a-20261025/pose-preview.js',R.parent/'m3-life-a-20261025/assets/seated-legs.svg']]
M['productionDestination']={'items':'apps/web/public/world-life/c/items/','actors':'apps/web/public/world-life/c/actors/','fixtures':'apps/web/public/world-life/c/fixtures/','poses':'apps/web/public/world-life/c/poses/','urlPrefix':'/assets/world-life/c/','masters':'design source only; not browser inventory payload'}
(R/'assets-manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n')
sp=json.loads((R/'spatial-manifest.json').read_text());(R/'npc-roster.json').write_text(json.dumps({'version':1,'count':7,'preserveFirstFive':True,'sourceCatalog':'2026-10-21.appearance-v1.1','npcs':sp['npcs'],'newNativeExports':M['actors'],'display':'No permanent Nxxx tags. Hover/focus/click name + role. Runtime coordinates from authoritative state, not initialCell. Neighbor has no dutyPlace.'},ensure_ascii=False,indent=2)+'\n')
print({'itemPNGs':len(M['items']),'actorSheets':len(M['actors']),'poseSheets':len(M['poses']),'fixturePNGs':len(M['fixtures']),'npcs':7})

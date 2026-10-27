from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,hashlib,shutil
R=Path(__file__).resolve().parent;SRC=Path(__import__('os').environ.get('PIXEL_CRAWLER_SOURCE','pixel-crawler-assets')).resolve();OUT=R/'assets';inv={r['source']:r for r in json.loads((R/'source-inventory.json').read_text())};records=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sheet(id,rel,ase,title,group,note,priority):
 p=SRC/rel;dest=OUT/(id+'.png');shutil.copyfile(p,dest);meta=inv[ase];im=Image.open(p);w,h=meta['frameSize'];box=im.crop((0,0,w,h)).getbbox();rec={'id':id,'title':title,'kind':'character','group':group,'priority':priority,'source':rel,'sourceSha256':sha(p),'file':'assets/'+dest.name,'fileSha256':sha(dest),'frameSize':[w,h],'frames':meta['frames'],'durationsMs':meta['durationsMs'],'firstFrameBBox':box,'visibleHeight':box[3]-box[1] if box else 0,'feetPivot':[(box[0]+box[2])/2,box[3]] if box else None,'note':note};records.append(rec);return rec
npcs=[('peasant','绿发平民',"Citizen_F/Peasant_A",'Idle/Idle','Walk/Walk','优先','草地、外街的普通居民；已有待机与走路，侧向角色。'),('tavern-a','酒馆女侍 A',"Citizen_F/Tavern_A",'Idle/Idle_Side','Walk/Walk_Side','优先','酒馆服务人物；另有端盘待机与端盘行走。'),('rogue','兜帽旅人','Rogue','Idle/Idle','Run/Run','候选','外形适合作为旅行者或居民服装；动作名 Run，不自动等同当前步行。'),('knight','铠甲人物','Knight','Idle/Idle','Run/Run','候选','辨识度高，适合特殊外观；会带来较明确的奇幻气质。'),('wizard','法袍人物','Wizzard','Idle/Idle','Run/Run','候选','完整法袍轮廓；可作特殊外观，不由美术新增职业或法术。')]
for id,title,folder,idler,walker,priority,note in npcs:
 root="Entities/Npc's/"+folder+'/'
 rec=sheet(id,root+idler+'-Sheet.png',root+idler+'.aseprite',title,'居民形象',note,priority)
 rec['motionId']=id+'-walk';sheet(id+'-walk',root+walker+'-Sheet.png',root+walker+'.aseprite',title+' · 行走','动作配套','已读原生 Aseprite 帧尺寸与时长；侧向，非四方向。',priority)
for id,folder in [('tavern-a','Tavern_A')]:
 for action in ['Idle_Hold','Walk_Hold']:
  stem='Idle_Side' if action=='Idle_Hold' else 'Walk_Side';root="Entities/Npc's/Citizen_F/"+folder+'/'+action+'/'
  sheet(id+'-'+action.lower(),root+stem+'-Sheet.png',root+stem+'.aseprite','端盘'+('待机' if action=='Idle_Hold' else '行走'),'动作配套','端盘内容必须对应真实活动；普通漫步不能一直端盘。','优先')
for id,folder,title in [('orc','Orc','兽人居民'),('orc-shaman','Orc - Shaman','兽人长者')]:
 root='Entities/Mobs/Orc Crew/'+folder+'/Idle/';sheet(id,root+'Idle-Sheet.png',root+'Idle.aseprite',title,'奇幻储备','只作风格储备；不是本轮新增敌人/战斗系统。','储备')
props=[
('bush-green','绿色灌木','Environment/Props/Static/Vegetation.png',[0,0,32,32],'林园与河岸','低','用于空地边缘；比现有素材轮廓深。'),
('bush-gold','金色灌木','Environment/Props/Static/Vegetation.png',[96,0,32,32],'林园与河岸','低','可建立少量秋色，避免整图混用所有季节。'),
('bush-rust','秋色灌木','Environment/Props/Static/Vegetation.png',[144,0,32,32],'林园与河岸','低','作为步道和花圃的颜色点缀。'),
('flower-pink','粉色花丛','Environment/Props/Static/Vegetation.png',[192,160,16,32],'林园与河岸','低','花圃/小路边；无碰撞或按根部小碰撞。'),
('flower-purple','紫色花丛','Environment/Props/Static/Vegetation.png',[208,160,16,32],'林园与河岸','低','适合河湾入口和阅读廊边缘。'),
('tree-summer','夏季乔木','Environment/Props/Static/Trees/Model_01/Size_03.png',[0,0,48,96],'林园与河岸','中','树冠更高；先在边缘小片种植，根部碰撞与冠层遮挡分开。'),
('rock-small','灰色岩块','Environment/Props/Static/Rocks.png',[128,16,32,32],'林园与河岸','低','用于河岸自然过渡，不阻挡通路。'),
('boardwalk','木栈道拼块','Environment/Props/Static/Furniture.png',[8,560,64,64],'外街与工坊','中','这是拼装部件，仍需按现有水岸与合法格重组。'),
('hanging-lamp','悬挂路灯','Environment/Props/Static/Furniture.png',[144,448,48,48],'外街与工坊','中','可丰富外街立面；灯光缓存复用现有机制。'),
('workbench','木工作台','Environment/Structures/Stations/Workbench/Workbench.png',[48,272,48,16],'外街与工坊','中','先作场景陈设；美术不自动开启制造行为。'),
('long-table','长餐桌','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[0,0,64,32],'酒馆与旅舍','中','适合餐饮空间，座位由现有业务另行映射。'),
('bench','木长椅','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[0,96,48,16],'酒馆与旅舍','低','可试用于步道或室内；脚底锚点要实测。'),
('bed','蓝色床铺','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[0,288,32,64],'酒馆与旅舍','中','旅舍内部备选；不由图片承诺室内场景已经开放。'),
('bookshelf','柜架','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[192,176,32,48],'酒馆与旅舍','中','补充书屋/室内墙面细节。'),
('rug','绿色地毯','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[336,336,48,48],'酒馆与旅舍','低','平面地饰，不增加物理碰撞。'),
('window','蓝色窗户','Environment/Structures/Buildings/Interior/Interior_Props_01.png',[64,176,32,32],'酒馆与旅舍','中','室内墙面组件，需与墙体成套使用。')]
for id,title,rel,rect,group,cost,note in props:
 p=SRC/rel;x,y,w,h=rect;im=Image.open(p).crop((x,y,x+w,y+h))
 if id=='hanging-lamp':
  im.paste((0,0,0,0),(16,34,48,48)) # Adjacent spare lantern is a different atlas object, not part of the lamp.
 dest=OUT/(id+'.png');im.save(dest);records.append({'id':id,'title':title,'kind':'prop','source':rel,'sourceSha256':sha(p),'rect':rect,'file':'assets/'+dest.name,'fileSha256':sha(dest),'size':[w,h],'alphaBBox':im.getbbox(),'group':group,'adaptation':cost,'note':note,'method':'exact crop; no recolor or redraw' if id!='hanging-lamp' else 'exact atlas extraction; remove adjacent spare lantern outside lamp silhouette; no repaint', 'sourceRects':[[144,448,48,34],[144,482,16,14]] if id=='hanging-lamp' else [rect]})
for id,title,rel,ase in [('campfire','小营火','Environment/Structures/Stations/Bonfire/Bonfire_01-Sheet.png','Environment/Structures/Stations/Bonfire/Bonfire_01.aseprite'),('grill','烤架','Environment/Structures/Stations/Cooking Station/Grill/Grill_01-Sheet.png','Environment/Structures/Stations/Cooking Station/Grill/Grill_01.aseprite')]:
 rec=sheet(id,rel,ase,title,'动态陈设','小循环可复用现有动画预算；不新增互动服务。','候选');rec['kind']='animated-prop'
# Author-provided reference only. Never relabel it as our new scene design.
shutil.copyfile(SRC/'MockUps/Tavern.png',OUT/'author-tavern-reference.png')
records.append({'id':'author-tavern','kind':'reference','title':'素材作者原始酒馆示范','source':'MockUps/Tavern.png','sourceSha256':sha(SRC/'MockUps/Tavern.png'),'file':'assets/author-tavern-reference.png','fileSha256':sha(OUT/'author-tavern-reference.png'),'note':'作者随包原始参考，非本次原创设计，非已实现功能。'})
manifest={'id':'pixel-crawler-selection-v1','sourceRoot':'pixel-crawler-assets','author':'Anokolisa','scope':'curated native asset review and scale experiments; no production changes','inventoryCounts':{'files':372,'png':181,'aseprite':190,'terms':1},'selectedCharacters':5,'fantasyReserve':2,'selectedProps':18,'duplicates':[{'paths':["Entities/Npc's/Citizen_F/Tavern_A","Entities/Npc's/Citizen_F/Tavern_B"],'verified':'Idle, Walk, Idle_Hold, Walk_Hold exported PNG RGBA pixels identical','decision':'count once as one finished appearance'}],'originalFilesUnmodified':True,'characterPolicy':'existing finished NPCs are side-view sets; Body_A is an unfinished base and New_Version is a color-coded rig, not finished avatars; check walking directional completeness before avatar adoption','records':records}
(R/'selection.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
# Pixel-exact contact sheet to inspect crop boundaries, not generative art.
out=Image.new('RGB',(960,600),'#e9e5d6');d=ImageDraw.Draw(out)
for i,r in enumerate([r for r in records if r['kind']=='prop']):
 im=Image.open(R/r['file']);box=im.getbbox();im=im.crop(box) if box else im;im.thumbnail((150,108),Image.Resampling.NEAREST);x=(i%6)*160;y=(i//6)*190;out.paste(im,(x+(160-im.width)//2,y+15),im);d.text((x+8,y+135),r['id'],fill='#314636');d.text((x+8,y+153),str(r['rect']),fill='#73765f')
out.save(R/'reference/crop-check.png');print('selected',len(records),'records')

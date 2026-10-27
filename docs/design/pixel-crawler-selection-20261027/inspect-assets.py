"""Read supplied native assets and export exact pixels for the local design review."""
from pathlib import Path
from PIL import Image
import struct,zlib,json,hashlib,shutil
R=Path(__file__).resolve().parent;SRC=Path(__import__('os').environ.get('PIXEL_CRAWLER_SOURCE','pixel-crawler-assets')).resolve()
def ase_info(p,export=None):
 b=p.read_bytes();frames,w,h,depth=struct.unpack_from('<HHHH',b,6);assert depth==32
 layers=[];allcels=[];dur=[];pos=128;out=[]
 for fi in range(frames):
  fsize,magic,chunks,duration=struct.unpack_from('<IHHH',b,pos);dur.append(duration);off=pos+16;cels={}
  for ci in range(chunks):
   n,t=struct.unpack_from('<IH',b,off);d=b[off+6:off+n]
   if t==0x2004:
    flags,kind,child,ww,hh,blend=struct.unpack_from('<HHHHHH',d);ln=struct.unpack_from('<H',d,16)[0];layers.append({'flags':flags,'type':kind,'child':child,'blend':blend,'opacity':d[12],'name':d[18:18+ln].decode()})
   if t==0x2005:
    layer,x,y,opacity,kind=struct.unpack_from('<HhhBH',d)
    if kind in [0,2]:
     cw,ch=struct.unpack_from('<HH',d,16);data=d[20:];data=zlib.decompress(data) if kind==2 else data;im=Image.frombytes('RGBA',(cw,ch),data);cels[layer]=(x,y,opacity,im)
    elif kind==1:
     link=struct.unpack_from('<H',d,16)[0];lx,ly,lo,im=allcels[link][layer];cels[layer]=(x,y,opacity,im)
    else:raise ValueError('unsupported tilemap cel')
   off+=n
  allcels.append(cels)
  if export:
   canvas=Image.new('RGBA',(w,h))
   for i,l in enumerate(layers):
    if not l['flags']&1 or i not in cels:continue
    assert l['blend']==0 and l['child']==0 and l['type']==0
    x,y,opacity,im=cels[i];assert opacity==255 and l['opacity']==255
    canvas.alpha_composite(im,(x,y))
   out.append(canvas)
  pos+=fsize
 info={'frames':frames,'frameSize':[w,h],'durationsMs':dur,'layers':[{'name':l['name'],'visible':bool(l['flags']&1)} for l in layers]}
 if export:
  sheet=Image.new('RGBA',(w*frames,h))
  for i,im in enumerate(out):sheet.paste(im,(i*w,0))
  sheet.save(export);info['export']=export.name;info['frameBboxes']=[f.getbbox() for f in out]
 return info
new=[]
for p in sorted((SRC/'Entities/Characters/New_Version').rglob('*.aseprite')):
 name='new-'+p.parent.name.lower()+'-'+p.stem.lower()+'.png';info=ase_info(p,R/'assets'/name);new.append({'source':str(p.relative_to(SRC)),**info})
(R/'new-version-export.json').write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n')
inventory=[]
for p in sorted(SRC.rglob('*')):
 if not p.is_file():continue
 data=p.read_bytes();row={'source':str(p.relative_to(SRC)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 if p.suffix=='.png':
  im=Image.open(p);row.update(size=list(im.size),mode=im.mode)
 if p.suffix=='.aseprite':row.update(ase_info(p))
 inventory.append(row)
(R/'source-inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
(R/'Terms.txt').write_text((SRC/'Terms.txt').read_text().rstrip()+'\n')
print('inventoried',len(inventory),'new-version native sheets',[(x['export'],x['frames'],x['frameSize'],x['frameBboxes'][0]) for x in new])

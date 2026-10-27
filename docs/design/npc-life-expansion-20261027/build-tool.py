from pathlib import Path
from PIL import Image
import json,hashlib
R=Path(__file__).parent
im=Image.open(R/'reference'/'watering-can-generated.png').convert('RGBA')
im.putalpha(im.getchannel('A').point(lambda v:255 if v>=160 else 0))
pieces=[];rects=[]
for r in range(2):
 for c in range(2):
  x0=round(c*im.width/2);y0=round(r*im.height/2);x1=round((c+1)*im.width/2);y1=round((r+1)*im.height/2)
  cell=im.crop((x0,y0,x1,y1));b=cell.getbbox();pieces.append(cell.crop(b));rects.append([x0+b[0],y0+b[1],x0+b[2],y0+b[3]])
factor=8/pieces[0].width
sheet=Image.new('RGBA',(128,32))
for c,p in enumerate(pieces):
 w=round(p.width*factor);h=round(p.height*factor)
 sheet.alpha_composite(p.resize((w,h),Image.Resampling.NEAREST),(c*32+18,17))
out=R/'assets'/'shared-water-fx.png';sheet.save(out)
d=json.loads((R/'environment-extraction.json').read_text());d['shared-water']={'file':'assets/shared-water-fx.png','sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'frameSize':[32,32],'frames':4,'durationsMs':[220]*4,'pivot':[16,24],'source':'reference/watering-can-generated.png','sourceRects':rects,'sourceScale':factor,'applyTo':'same participant actor group while matching active watering; never replace participant body','parkedFrame':0,'toolOwnership':'fixed at care point; not inventory reward','parkedAnchorOffsetFromTarget':[8,4]}
(R/'environment-extraction.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

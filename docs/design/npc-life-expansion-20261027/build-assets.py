"""Technical atlas extraction only: generated sources remain preserved in reference/.
No pose drawing or identity replacement. Nearest sampling and binary alpha produce
integer native pixels; per-frame authored crop/scale/pivot are recorded for review.
"""
from pathlib import Path
from PIL import Image
import json, hashlib, shutil

ROOT = Path(__file__).parent
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def bands(values, minimum=40, gap=9):
    spans=[]; start=None; last=None
    for i,v in enumerate(values):
        if v:
            if start is None: start=i
            elif i-last>gap:
                if last-start+1>=minimum: spans.append((start,last+1))
                start=i
            last=i
    if start is not None and last-start+1>=minimum: spans.append((start,last+1))
    return spans

def atlas(name, actions):
    src=ROOT/'reference'/f'{name}-generated.png'
    if not src.exists(): return None
    im=Image.open(src).convert('RGBA'); a=im.getchannel('A').point(lambda v: 255 if v>=160 else 0)
    rows=bands([sum(a.getpixel((x,y))>0 for x in range(im.width))>20 for y in range(im.height)])
    assert len(rows)==5, (name, rows)
    crop_rows=[]
    for y0,y1 in rows:
        cols=bands([sum(a.getpixel((x,y))>0 for y in range(y0,y1))>10 for x in range(im.width)])
        assert len(cols)==4,(name,cols)
        crop_rows.append([(x0,y0,x1,y1) for x0,x1 in cols])
    standing_h=max(b[3]-b[1] for b in crop_rows[0])
    factor=16/standing_h
    result={}
    for row,action in enumerate(actions):
        sheet=Image.new('RGBA',(128,32)); details=[]
        for c,rect in enumerate(crop_rows[row]):
            piece=im.crop(rect);piece.putalpha(a.crop(rect))
            w=max(1,round(piece.width*factor));h=max(1,round(piece.height*factor))
            piece=piece.resize((w,h),Image.Resampling.NEAREST)
            # Lock the torso to the idle centre; extended hands do not shift the feet.
            idle=crop_rows[0][c]; anchor=(idle[0]+idle[2])/2
            left=16+round((rect[0]-anchor)*factor);top=24-h
            assert left>=0 and top>=0 and left+w<=32,(name,action,c,left,top,w,h)
            sheet.alpha_composite(piece,(c*32+left,top))
            details.append({'sourceRect':list(rect),'destinationRect':[left,top,w,h],'alphaBBox':list(sheet.crop((c*32,0,c*32+32,32)).getbbox())})
        out=ROOT/'assets'/f'{name}-{action}.png';sheet.save(out)
        result[action]={'file':str(out.relative_to(ROOT)),'sha256':sha(out),'frames':4,'frameSize':[32,32],'durationsMs':[180]*4 if action=='walk' else [240]*4,'feetPivot':[16,24],'extraction':details}
    return {'generatedSource':str(src.relative_to(ROOT)),'generatedSha256':sha(src),'normalization':'Nearest-neighbour technical downsampling; alpha threshold 160; no redrawn pixels','sourceRows':rows,'scale':factor,'actions':result}

if __name__=='__main__':
    data={}
    for name,actions in [('qinghe',['idle','walk','point','water','clean']),('xiaoman',['idle','walk','tray','sit-quiet','sit-talk']),('wenxi',['idle','walk','point','listen','map'])]:
        record=atlas(name,actions)
        if record: data[name]=record
    (ROOT/'asset-extraction.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    care=Image.open(ROOT/'reference'/'care-generated.png').convert('RGBA')
    mask=care.getchannel('A').point(lambda v:255 if v>=160 else 0)
    rows=bands([sum(mask.getpixel((x,y))>0 for x in range(care.width))>30 for y in range(care.height)])
    assert len(rows)==2,rows
    env={}
    for r,name in enumerate(['watering','cleaning']):
        y0,y1=rows[r]
        cols=bands([sum(mask.getpixel((x,y))>0 for y in range(y0,y1))>15 for x in range(care.width)])
        assert len(cols)==4,cols
        factor=24/(cols[0][1]-cols[0][0]);sheet=Image.new('RGBA',(128,32));details=[]
        for c,(x0,x1) in enumerate(cols):
            alpha=mask.crop((x0,y0,x1,y1));b=alpha.getbbox();rect=(x0+b[0],y0+b[1],x0+b[2],y0+b[3])
            piece=care.crop(rect);piece.putalpha(mask.crop(rect))
            w=round(piece.width*factor);h=round(piece.height*factor)
            piece=piece.resize((w,h),Image.Resampling.NEAREST)
            sheet.alpha_composite(piece,(c*32+16-w//2,24-h))
            details.append({'sourceRect':list(rect),'alphaBBox':list(sheet.crop((c*32,0,c*32+32,32)).getbbox())})
        out=ROOT/'assets'/f'care-{name}.png';sheet.save(out)
        env[name]={'file':str(out.relative_to(ROOT)),'sha256':sha(out),'frameSize':[32,32],'frames':4,'pivot':[16,24],'framesMeaning':['neutral','active','committed-completed','unused-alternate'],'extraction':details}
    for kind,source,rect in [('water','water',(20,16,28,24)),('clean','clean',(20,22,28,25))]:
        im=Image.open(ROOT/'assets'/f'qinghe-{source}.png');sheet=Image.new('RGBA',(128,32))
        for c in range(4):
            x0,y0,x1,y1=rect;sheet.alpha_composite(im.crop((c*32+x0,y0,c*32+x1,y1)),(c*32+x0,y0))
        out=ROOT/'assets'/f'shared-{kind}-fx.png';sheet.save(out)
        env['shared-'+kind]={'file':str(out.relative_to(ROOT)),'sha256':sha(out),'frameSize':[32,32],'frames':4,'pivot':[16,24],'source':'technical extraction from Qinghe generated action; only tool/water or loose leaves, never head/body','sourceRectPerFrame':list(rect),'applyTo':'authoritative active participant; preserve original appearance'}
    (ROOT/'environment-extraction.json').write_text(json.dumps(env,ensure_ascii=False,indent=2)+'\n')
    # Enlarged contact sheet is an inspection of extracted pixels, not new artwork.
    sheet=Image.new('RGBA',(4*32*5,5*32*5),(234,233,217,255))
    if 'qinghe' in data:
        for row,action in enumerate(data['qinghe']['actions']):
            im=Image.open(ROOT/data['qinghe']['actions'][action]['file']).resize((640,160),Image.Resampling.NEAREST)
            sheet.alpha_composite(im,(0,row*160))
        sheet.convert('RGB').save(ROOT/'reference'/'qinghe-pixels.png')
    print({n:{a:max(f['alphaBBox'][3]-f['alphaBBox'][1] for f in v['extraction']) for a,v in d['actions'].items()} for n,d in data.items()})

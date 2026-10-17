"""Render a development frame JSON as a terminal contact sheet image."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--frame-json',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
frame=json.loads(args.frame_json.read_text())
w,h=frame['size']['columns'],frame['size']['rows']
image=Image.new('RGB',(w*10+40,h*20+40),'#101112');draw=ImageDraw.Draw(image)
latin=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',16)
cjk=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',18,index=2)
latin_bold=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',16)
cjk_bold=ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',18,index=2)
def palette(n):
 if n>=232:return (8+(n-232)*10,)*3
 if n>=16:
  n-=16
  return tuple(55+v*40 if v else 0 for v in (n//36,n//6%6,n%6))
 return [(0,0,0),(128,0,0),(0,128,0),(128,128,0),(0,0,128),(128,0,128),(0,128,128),(192,192,192),(128,128,128),(255,0,0),(0,255,0),(255,255,0),(0,0,255),(255,0,255),(0,255,255),(255,255,255)][n]
for i,cell in enumerate(frame['cells']):
 x,y=20+i%w*10,20+i//w*20
 draw.rectangle((x,y,x+9,y+19),fill=palette(cell['bg']))
for i,cell in enumerate(frame['cells']):
 if cell['continuation'] or cell['g']==' ':continue
 x,y=20+i%w*10,20+i//w*20
 if cell['g']=='█':draw.rectangle((x,y,x+9,y+19),fill=palette(cell['fg']))
 else:
  font=(cjk_bold if cell['bold'] else cjk) if cell['width']==2 else (latin_bold if cell['bold'] else latin)
  draw.text((x,y+17),cell['g'],font=font,fill=palette(cell['fg']),anchor='ls')
args.output.parent.mkdir(parents=True,exist_ok=True)
image.save(args.output)

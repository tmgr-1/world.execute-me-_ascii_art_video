"""Build checked-in character bitmaps, never needed by the player."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

letters = {
 'A':['01110','10001','10001','11111','10001','10001','10001'],
 'C':['01110','10001','10000','10000','10000','10001','01110'],
 'D':['11110','10001','10001','10001','10001','10001','11110'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'F':['11111','10000','10000','11110','10000','10000','10000'],
 'G':['01110','10001','10000','10111','10001','10001','01110'],
 'I':['111','010','010','010','010','010','111'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'N':['10001','11001','11001','10101','10011','10011','10001'],
 'O':['01110','10001','10001','10001','10001','10001','01110'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 'R':['11110','10001','10001','11110','10100','10010','10001'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
 'i':['00100','00000','01100','00100','00100','00100','01110'],
 'n':['00000','00000','11110','10001','10001','10001','10001'],
 'd':['00001','00001','01111','10001','10001','10001','01111'],
 'o':['00000','00000','01110','10001','10001','10001','01110'],
 's':['00000','00000','01111','10000','01110','00001','11110'],
 't':['00100','00100','11111','00100','00100','00100','00011'],
 'r':['00000','00000','10110','11001','10000','10000','10000'],
 'e':['00000','00000','01110','10001','11111','10000','01111'],
 'm':['00000','00000','11011','10101','10101','10101','10101'],
}
result = {}
for word in ('Ein','dos','trois','Fem','PROGRAM','PROCESS','TERMINATED'):
 rows=['0'.join(letters[c][y] for c in word) for y in range(7)]
 bitmap=[''.join('##' if p=='1' else '  ' for p in row) for row in rows]
 if word in ('PROGRAM', 'PROCESS', 'TERMINATED'): bitmap = [row for row in bitmap for _ in range(2)]
 result[word]={'sourceText':word,'bitmap':bitmap,'sourceFont':'Original 5x7 bitmap','license':'CC0-1.0'}
 if word in ('PROCESS', 'TERMINATED'):
  result[word+'.compact']={'sourceText':word,'bitmap':bitmap[::2],'sourceFont':'Original 5x7 bitmap, native seven-row title','license':'CC0-1.0'}
font_path='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font=ImageFont.truetype(font_path,18,index=2)
for word in ('네','六','终止','程序','已被终止'):
 bbox=font.getbbox(word); image=Image.new('L',(bbox[2]-bbox[0]+4,bbox[3]-bbox[1]+4))
 ImageDraw.Draw(image).text((2-bbox[0],2-bbox[1]),word,font=font,fill=255)
 image=image.crop(image.getbbox())
 bitmap=[''.join('##' if image.getpixel((x,y))>=85 else '  ' for x in range(image.width)) for y in range(image.height)]
 result[word]={'sourceText':word,'bitmap':bitmap,'sourceFont':'Noto Sans CJK, 18px','license':'OFL-1.1','licenseUrl':'https://github.com/notofonts/noto-cjk/blob/main/LICENSE'}
for word in ('程序','已被终止'):
 compact_font=ImageFont.truetype(font_path,13,index=2)
 bbox=compact_font.getbbox(word); image=Image.new('L',(bbox[2]-bbox[0]+4,bbox[3]-bbox[1]+4))
 ImageDraw.Draw(image).text((2-bbox[0],2-bbox[1]),word,font=compact_font,fill=255)
 image=image.crop(image.getbbox())
 bitmap=[''.join('##' if image.getpixel((x,y))>=85 else '  ' for x in range(image.width)) for y in range(image.height)]
 result[word+'.compact']={'sourceText':word,'bitmap':bitmap,'sourceFont':'Noto Sans CJK, 13px','license':'OFL-1.1','licenseUrl':'https://github.com/notofonts/noto-cjk/blob/main/LICENSE'}
# Whole-title assets use explicit character gaps and native sizes. The smallest
# reproduces the approved 125-column console preview without resampling strokes.
word='程序已被终止'
for suffix,size,gap in (('',12,2),('.compact',10,1),('.large',17,2),('.xlarge',20,2)):
 title_font=ImageFont.truetype(font_path,size,index=2)
 bbox=title_font.getbbox(word);height=bbox[3]-bbox[1];letters_bitmap=[]
 for char in word:
  image=Image.new('L',(size,height))
  ImageDraw.Draw(image).text((0,-bbox[1]),char,font=title_font,fill=255)
  letters_bitmap.append([''.join('##' if image.getpixel((x,y))>=85 else '  ' for x in range(size)) for y in range(height)])
 bitmap=[(' '*gap).join(letter[y] for letter in letters_bitmap) for y in range(height)]
 result[word+suffix]={'sourceText':word,'bitmap':bitmap,'sourceFont':f'Noto Sans CJK, {size}px, {gap}-column character gaps','license':'OFL-1.1','licenseUrl':'https://github.com/notofonts/noto-cjk/blob/main/LICENSE'}
out=Path('films/world-execute/assets/glyphs.json');out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for word,g in result.items():
 print(word, len(g['bitmap'][0]),len(g['bitmap']))

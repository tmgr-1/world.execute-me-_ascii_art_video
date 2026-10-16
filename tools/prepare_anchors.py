"""Convert section alignment into unreviewed, reproducible film anchors."""
import argparse
import json
import re
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--alignment',type=Path,default=Path('.cache/alignment/sections.json'))
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
reference=json.loads(args.alignment.read_text())
lines=reference['lines']
if len(lines)!=93 or [line['number'] for line in lines]!=list(range(1,94)):
 raise ValueError('Expected exactly 93 numbered script nodes; do not silently reindex missing lyrics.')
anchors=[]
def anchor(name,seconds):anchors.append({'id':name,'atMs':round(seconds*1000),'status':'rough'})
def normal(word):return re.sub('[^a-z]','',word.lower())
for line in lines:
 anchor(f'lyric.{line["number"]:02d}.start',line['start'])
 anchor(f'lyric.{line["number"]:02d}.end',line['end'])
keywords={10:['dimension'],12:['circumference'],14:['tangents'],16:['limitations'],18:['ac','dc'],22:['ad','bc'],24:['deeply'],61:['erase','fragments']}
for line in lines:
 for key in keywords.get(line['number'],[]):
  word=next((word for word in line.get('words',[]) if normal(word['word'])==key),None)
  if word is None:raise ValueError(f'Missing word anchor {line["number"]}:{key}; listening review is required.')
  anchor(f'lyric.{line["number"]:02d}.{key}',word['start'])
for i,(n,token) in enumerate([(73,'ein'),(73,'dos'),(74,'trios'),(74,'ne'),(75,'fem'),(75,'liu')],1):
 line=lines[n-1]
 word=next((word for word in line.get('words',[]) if normal(word['word'])==token),None)
 if word is None:raise ValueError(f'Missing multilingual count: {token}; no digit substitution is allowed.')
 anchor(f'count.{i}',word['start'])
base=lines[7]['end']
for name,offset in [('intro.connect',.75),('intro.greeting.type',1.7),('intro.greeting.complete',2.85),('intro.greeting.send',3.3),('intro.greeting.reply',4)]:anchor(name,base+offset)
anchor('session.close',lines[25]['start']+.35)
anchors.sort(key=lambda a:(a['atMs'],a['id']))
result={'version':1,'audioSha256':reference['audioSha256'],'durationMs':211944,'originAudioMs':0,'method':reference['method'],'reviewed':False,
 'notes':['Machine estimates; listening review required before release.','The supplied .lyc has 92 lines; the design script has 93, adding one repeated You have left.','Phrase windows constrain alignment across instrumentals.'], 'anchors':anchors}
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f'Saved {len(anchors)} rough anchors; no listening approval was inferred.')

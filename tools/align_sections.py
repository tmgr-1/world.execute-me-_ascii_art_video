"""Constrain reference alignment to authored phrase windows around instrumentals."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--music-file', type=Path, required=True)
parser.add_argument('--lyrics', type=Path, default=Path('films/world-execute/lyrics.json'))
parser.add_argument('--sections', type=Path, default=Path('films/world-execute/alignment-sections.json'))
parser.add_argument('--output', type=Path, default=Path('.cache/alignment/sections.json'))
parser.add_argument('--model-dir', type=Path, default=Path('.cache/whisper'))
args = parser.parse_args()
if not (args.model_dir / 'small.pt').is_file():
    parser.error('Local small.pt is required; no model is downloaded.')
import torch
import whisper
import stable_whisper
torch.set_num_threads(8)
with (args.model_dir/'small.pt').open('rb') as weights:
    if hashlib.file_digest(weights,'sha256').hexdigest() != whisper._MODELS['small'].split('/')[-2]:
        parser.error('Local small.pt checksum mismatch; no download was attempted.')
model = stable_whisper.load_model('small', device='cpu', download_root=str(args.model_dir))
audio = whisper.load_audio(str(args.music_file.resolve()))
lyrics = json.loads(args.lyrics.read_text())
output = {'status':'rough','method':'stable-ts-section-constrained','audioSha256':hashlib.file_digest(args.music_file.open('rb'),'sha256').hexdigest(),'lines':[]}
for section in json.loads(args.sections.read_text()):
    lines = lyrics[section['from']-1:section['to']]
    start = section['start']
    result = model.align(audio[round(start*16000):round(section['end']*16000)], '\n'.join(line['text'] for line in lines),
                         language='en', original_split=True, token_step=150, max_word_dur=8,
                         word_dur_factor=None, nonspeech_skip=None, suppress_silence=False, vad=False)
    if result is None or len(result.segments) != len(lines):
        raise RuntimeError(f'Section segmentation failed: {section}')
    for line, segment in zip(lines,result.to_dict()['segments']):
        segment['start'] += start;segment['end'] += start
        for word in segment.get('words',[]):word['start'] += start;word['end'] += start
        output['lines'].append({**line,**segment})
    print(f"Aligned {section['from']:02d}-{section['to']:02d}",flush=True)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')

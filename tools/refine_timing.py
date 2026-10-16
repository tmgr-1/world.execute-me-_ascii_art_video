"""Re-align short lyric groups and refine word boundaries using local weights.

The result remains a machine estimate. It never approves listening review or
overwrites the film's anchors. Every intermediate group is saved for inspection.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--music-file', type=Path, required=True)
    parser.add_argument('--alignment', type=Path, default=Path('.cache/alignment/sections.json'))
    parser.add_argument('--model-dir', type=Path, default=Path('.cache/whisper'))
    parser.add_argument('--output', type=Path, default=Path('.cache/alignment/refined.json'))
    parser.add_argument('--groups', default='76,73-75,67-72,9-10,11-12,13-14,15-16,17-18,21-22,23-24,85,93')
    parser.add_argument('--threads', type=int, default=8)
    parser.add_argument('--refine', action='store_true')
    args = parser.parse_args()
    checkpoint = args.model_dir / 'small.pt'
    if not checkpoint.is_file() or not args.music_file.is_file():
        parser.error('A local audio file and small.pt are required; downloads are disabled.')

    import torch
    import whisper
    import stable_whisper

    expected = whisper._MODELS['small'].split('/')[-2]
    with checkpoint.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            parser.error('Local checkpoint checksum mismatch; no download attempted.')
    with args.music_file.open('rb') as stream:
        fingerprint = hashlib.file_digest(stream, 'sha256').hexdigest()
    source = json.loads(args.alignment.read_text())
    if source['audioSha256'] != fingerprint:
        parser.error('The baseline alignment belongs to a different audio file.')
    torch.set_num_threads(args.threads)
    model = stable_whisper.load_model('small', device='cpu', download_root=str(args.model_dir))
    audio = whisper.load_audio(str(args.music_file.resolve()))
    output = {
        'status': 'rough', 'reviewedByListening': False,
        'method': 'short-context-dynamic-heads' + ('-probability-refinement-20ms' if args.refine else ''),
        'audioSha256': fingerprint, 'model': 'small', 'modelSha256': expected,
        'groups': [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)

    for specification in args.groups.split(','):
        bounds = [int(n) for n in specification.split('-')]
        first, last = bounds[0], bounds[-1]
        if not 1 <= first <= last <= len(source['lines']):
            parser.error(f'Invalid group: {specification}')
        lines = source['lines'][first - 1:last]
        # Extra context is bounded by neighbouring phrases so repeated words in
        # the next group cannot absorb this group's final word.
        start = max(0, lines[0]['start'] - .55)
        end = min(len(audio) / 16000, lines[-1]['end'] + .55)
        if first > 1:
            start = max(start, source['lines'][first - 2]['end'] - .10)
        if last < len(source['lines']):
            end = min(end, source['lines'][last]['start'] + .10)
        sample = audio[round(start * 16000):round(end * 16000)]
        text = '\n'.join(line['text'] for line in lines)
        # Correct unambiguous spelling only; the original reference is preserved.
        text = text.replace('set of point\n', 'set of points\n').replace('give u ', 'give you ')
        text = text.replace('Trios, ne', 'trois, ne')
        result = model.align(sample, text, language='en', original_split=True,
                             token_step=150, word_dur_factor=None, max_word_dur=8,
                             suppress_silence=False, vad=False, nonspeech_skip=None,
                             dynamic_heads='8,3', verbose=None)
        if result is None or len(result.segments) != len(lines):
            raise RuntimeError(f'Group failed to preserve nodes: {specification}')
        before_refinement = copy.deepcopy(result.to_dict()['segments'])
        if args.refine:
            model.refine(sample, result, precision=.02, abs_dur_change=.25,
                         rel_dur_change=None, prob_threshold=.3,
                         rel_prob_decrease=.03, abs_prob_decrease=.05, verbose=None)
        segments = result.to_dict()['segments']
        for collection in (segments, before_refinement):
            for line, segment in zip(lines, collection):
                segment['number'] = line['number']
                segment['start'] = round(segment['start'] + start, 3)
                segment['end'] = round(segment['end'] + start, 3)
                for word in segment.get('words', []):
                    word['start'] = round(word['start'] + start, 3)
                    word['end'] = round(word['end'] + start, 3)
        output['groups'].append({'from': first, 'to': last, 'window': [start, end],
                                 'aligned': before_refinement, 'refined': segments})
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
        print(f'Group {specification}: ' + '; '.join(
            f"{s['number']:02d} {s['start']:.3f}–{s['end']:.3f}" for s in segments), flush=True)


if __name__ == '__main__':
    main()

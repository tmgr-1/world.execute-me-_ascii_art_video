"""Conservatively combine timing evidence without approving human review."""
from __future__ import annotations

import argparse
import copy
import itertools
import json
import re
import statistics
from pathlib import Path


def normal(text):
    word = re.sub('[^a-z]', '', text.lower())
    return {'points': 'point', 'trois': 'trios'}.get(word, word)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, default=Path('films/world-execute/timing-evidence.json'))
    parser.add_argument('--refinement', type=Path, default=Path('.cache/alignment/refined.json'))
    parser.add_argument('--transcription', type=Path, default=Path('.cache/alignment/transcription.json'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, default=Path('.cache/alignment/refinement-report.json'))
    args = parser.parse_args()
    base = json.loads(args.base.read_text())
    evidence = json.loads(args.evidence.read_text())
    refinement = json.loads(args.refinement.read_text())
    transcription = json.loads(args.transcription.read_text())
    if any(document['audioSha256'] != base['audioSha256'] for document in (evidence, refinement, transcription)):
        parser.error('All evidence must belong to the same audio fingerprint.')
    baseline = {line['number']: line for line in evidence['lines']}
    short = {line['number']: line for group in refinement['groups'] for line in group['aligned']}
    precise = {line['number']: line for group in refinement['groups'] for line in group['refined']}
    raw_words = [word for segment in transcription['segments'] for word in segment.get('words', [])]
    result = copy.deepcopy(base)
    points = {anchor['id']: anchor for anchor in result['anchors']}
    report = {'audioSha256': base['audioSha256'], 'reviewedByListening': False,
              'method': 'bounded-context-consensus', 'changes': [], 'deferred': [], 'notes': [
                  'All times remain machine estimates. No human listening approval is inferred.',
                  'A 20 ms refinement grid does not establish 20 ms accuracy.',
                  'Large disagreements, crop-edge hits, collapsed words and unreliable repetitions are deferred.',
              ]}

    def word_for(line, suffix):
        words = line['words']
        if suffix == 'start': return words[0], 'start'
        if suffix == 'end': return words[-1], 'end'
        return next((word for word in words if normal(word['word']) == suffix), None), 'start'

    def valid(word):
        return word is not None and .04 <= word['end'] - word['start'] <= 1.5

    for identifier, anchor in points.items():
        match = re.fullmatch(r'lyric\.(\d+)\.(\w+)', identifier)
        count = re.fullmatch(r'count\.(\d+)', identifier)
        if count:
            n, suffix = [(73, 'ein'), (73, 'dos'), (74, 'trios'), (74, 'ne'), (75, 'fem'), (75, 'liu')][int(count[1]) - 1]
        elif match:
            n, suffix = int(match[1]), match[2]
        else: continue
        if n not in short: continue
        before, edge = word_for(baseline[n], suffix)
        after, _ = word_for(short[n], suffix)
        refined_word, _ = word_for(precise[n], suffix)
        old_ms = anchor['atMs']
        if before is None or after is None: continue
        # Probability-based shrinking sometimes leaves only a vowel fragment.
        # Use it only when it stays near the DTW boundary and keeps a real word.
        selected = after
        if valid(refined_word) and abs(refined_word[edge] - after[edge]) <= .08:
            selected = refined_word
        raw = [word for word in raw_words if normal(word['word']) == normal(before['word']) and valid(word)
               and word.get('probability', 0) >= .5 and abs(word['start'] - before['start']) <= .65]
        independent = min(raw, key=lambda word: abs(word['start'] - before['start'])) if raw else None
        candidates = [('baseline', old_ms)]
        if valid(selected) and (selected.get('probability', 0) >= .3 or count):
            candidates.append(('short-context', round(selected[edge] * 1000)))
        if independent is not None:
            candidates.append(('transcription', round(independent[edge] * 1000)))
        # The first If was sometimes collapsed onto I'm. Recover the utterance
        # onset from a short context when the following word remains confident.
        recovered_onset = suffix == 'start' and before['end'] - before['start'] < .04 and normal(before['word']) == 'if' \
            and valid(after) and after['end'] - after['start'] <= .6 and len(short[n]['words']) > 1 \
            and short[n]['words'][1].get('probability', 0) >= .5 and abs(after['start'] * 1000 - old_ms) <= 450
        if recovered_onset:
            proposal = round(after['start'] * 1000 / 10) * 10
            reason = 'recover-collapsed-first-word'
        else:
            clusters = [list(items) for size in range(2, len(candidates) + 1) for items in itertools.combinations(candidates, size)
                        if max(value for _, value in items) - min(value for _, value in items) <= 80]
            if not clusters:
                report['deferred'].append({'id': identifier, 'atMs': old_ms, 'candidates': dict(candidates),
                                          'reason': 'disagreement-or-degenerate-word' if len(candidates) > 1 or not valid(after) else 'insufficient-evidence'})
                continue
            cluster = min(clusters, key=lambda items: (-len(items), 'transcription' not in dict(items),
                          max(value for _, value in items) - min(value for _, value in items)))
            proposal = round(statistics.median(value for _, value in cluster) / 10) * 10
            reason = 'context-consensus'
            if abs(proposal - old_ms) > 250:
                report['deferred'].append({'id': identifier, 'atMs': old_ms, 'candidates': dict(candidates), 'reason': 'change-exceeds-bound'})
                continue
        if proposal != old_ms:
            anchor['atMs'] = proposal; anchor['status'] = 'rough'
            report['changes'].append({'id': identifier, 'beforeMs': old_ms, 'afterMs': proposal,
                                      'deltaMs': proposal - old_ms, 'reason': reason, 'candidates': dict(candidates)})

    # The first word of a count pair is also that lyric's start, not a second
    # independently movable occurrence of the same syllable.
    for n, ordinal in [(73, 1), (74, 3), (75, 5)]:
        lyric, count = points[f'lyric.{n:02d}.start'], points[f'count.{ordinal}']
        if lyric['atMs'] != count['atMs']:
            old = lyric['atMs']; lyric['atMs'] = count['atMs']; lyric['status'] = 'rough'
            report['changes'].append({'id': lyric['id'], 'beforeMs': old, 'afterMs': lyric['atMs'],
                                      'deltaMs': lyric['atMs'] - old, 'reason': 'share-count-syllable-onset'})
    # Independently cropped phrases may overlap by one 20 ms attention frame.
    # Resolve only this small boundary overlap; larger disagreements are errors.
    for n in range(2, 94):
        left, right = points[f'lyric.{n-1:02d}.end'], points[f'lyric.{n:02d}.start']
        if left['atMs'] > right['atMs']:
            if left['atMs'] - right['atMs'] > 40:
                raise ValueError(f'Unresolved phrase overlap at node {n}; do not hide it by sorting anchors.')
            old = left['atMs']; left['atMs'] = right['atMs']; left['status'] = 'rough'
            report['changes'].append({'id': left['id'], 'beforeMs': old, 'afterMs': left['atMs'],
                                      'deltaMs': left['atMs'] - old, 'reason': 'resolve-one-attention-frame-overlap'})
    for n in range(1, 94):
        if points[f'lyric.{n:02d}.start']['atMs'] >= points[f'lyric.{n:02d}.end']['atMs']:
            raise ValueError(f'Invalid lyric span {n}')
    result['anchors'].sort(key=lambda anchor: (anchor['atMs'], anchor['id']))
    result['reviewed'] = False
    result['method'] = 'stable-ts-section-plus-bounded-context-consensus'
    result['notes'] = [*base.get('notes', []), 'Short-context and transcription evidence reviewed computationally; listening review remains incomplete.']
    for path, document in [(args.output, result), (args.report, report)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
    print(f"Saved {len(report['changes'])} bounded adjustments; {len(report['deferred'])} candidates deferred; listening status remains unreviewed.")


if __name__ == '__main__':
    main()

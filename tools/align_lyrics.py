"""Offline, reference-assisted timing. Machine output is always unreviewed."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--music-file", type=Path, required=True)
    parser.add_argument("--lyrics-file", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, default=Path(".cache/whisper"))
    parser.add_argument("--model", default="small")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--transcribe", action="store_true")
    args = parser.parse_args()
    if not args.music_file.is_file() or not args.lyrics_file.is_file():
        parser.error("Music and reference lyrics must be readable local files.")
    if not (args.model_dir / f"{args.model}.pt").is_file():
        parser.error("Model weights are missing; this tool does not download them.")
    import torch
    import whisper
    import stable_whisper

    torch.set_num_threads(args.threads)
    if args.model not in whisper._MODELS:
        parser.error('Use a named official local checkpoint, such as small or medium.')
    expected = whisper._MODELS[args.model].split('/')[-2]
    with (args.model_dir / f'{args.model}.pt').open('rb') as weights:
        if hashlib.file_digest(weights, 'sha256').hexdigest() != expected:
            parser.error('Local model checksum mismatch; refusing an implicit download.')
    model = stable_whisper.load_model(args.model, device="cpu", download_root=str(args.model_dir))
    lines = [line.strip() for line in args.lyrics_file.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.transcribe:
        result = model.transcribe(str(args.music_file.resolve()), language="en", fp16=False,
                                  word_timestamps=True, regroup=False,
                                  condition_on_previous_text=False, suppress_silence=False, vad=False)
    else:
        result = model.align(str(args.music_file.resolve()), "\n".join(lines), language="en",
                             original_split=True, token_step=150, max_word_dur=8.0,
                             word_dur_factor=None, nonspeech_skip=None,
                             suppress_silence=False, vad=False)
    if result is None:
        raise RuntimeError("Alignment failed. No timestamps were approved.")
    document = result.to_dict()
    document["referenceLines"] = lines
    document["status"] = "rough"
    document["method"] = "whisper-transcription" if args.transcribe else "stable-ts-reference-alignment"
    document["audioSha256"] = hashlib.file_digest(args.music_file.open("rb"), "sha256").hexdigest()
    document["model"] = args.model
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(document['segments'])} unreviewed segments to {args.output}", flush=True)


if __name__ == "__main__":
    main()

# world.execute(me); — ASCII terminal film

[简体中文](README.zh-CN.md)

A music-driven ASCII film for your terminal, set to Mili's **world.execute(me);**. Messages, geometric graphics, waveforms, virtual memory, and task activity follow the song in real time.

Built with Node.js and TypeScript, with mpv playing your local music file. Supports English and Chinese interfaces, six-language lettering, pause, seeking, and section loops.

## Requirements

- Node.js 24 and npm.
- mpv, available as `mpv` in your terminal.
- A terminal with at least **130 columns × 35 rows**. A full-screen terminal with **160 columns × 45 rows** or more is recommended.
- A monospace font setup with Chinese and Korean coverage, such as DejaVu Sans Mono with Noto CJK fallback.

On Ubuntu or Debian, install the player and fonts with:

```bash
sudo apt install mpv fonts-dejavu-core fonts-noto-cjk
```

## Installation

```bash
git clone https://github.com/tmgr-1/world.execute-me-_ascii_art_video.git
cd world.execute-me-_ascii_art_video
npm ci
```

## Playback

Provide a local MP3 of **world.execute(me);** through `--music-file`. The filename can be anything, including a renamed copy:

```bash
npm run play -- --music-file "./song.mp3" --lang en --rehearsal
```

Replace `./song.mp3` with the actual path to your file. Relative and absolute paths both work; keep the quotes if the path contains spaces.

Press **Enter** at the ready screen to begin. Use `--lang cn` for the Chinese interface. The examples use `--rehearsal` to enable the navigation and offset controls below.

The film fills the terminal's current dimensions. Shrinking the window below the minimum size pauses playback; resize it and press Space to resume.

| Key | Action |
|---|---|
| Enter | Start playback |
| Space | Pause or resume |
| q, Esc, Ctrl+C | Quit and restore the terminal |
| ← / → | Seek backward or forward by 5 seconds |
| ↑ / ↓ | Adjust the visual offset by 20 ms |
| [ / ] | Jump to the previous or next lyric cue |

Start at a specific point:

```bash
npm run play -- --music-file "./song.mp3" --lang en --rehearsal --seek 01:14
```

Loop a section:

```bash
npm run play -- --music-file "./song.mp3" --lang en --rehearsal --loop 02:38..02:46
```

Other common options:

| Option | Purpose |
|---|---|
| `--offset-ms 80` | Advance the visuals by 80 ms; negative values delay them |
| `--speed 0.5` | Set playback speed, from 0.25 to 2 |
| `--no-color` | Disable colored output |
| `--mpv-path /path/to/mpv` | Use a specific player executable |
| `--hold-end` | Keep the final frame visible until you press q |

Playback requires no Python, PyTorch, Whisper, or network connection.

## License

The source code and original documentation are licensed under **GNU GPL v3** (`GPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The song and lyrics belong to Mili. This repository does not include the music recording. Third-party dependencies and lettering assets retain their respective licenses; see the [asset notes](films/world-execute/assets/README.md).

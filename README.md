# world.execute(me); — 终端字符影片

在终端中演出的音乐字符影片，以 Mili 的 **world.execute(me);** 为内容。音乐播放时，聊天、输入、几何图形、波形、虚拟内存和任务状态随节奏变化，组成一段程序与用户之间的故事。

画面由 Node.js / TypeScript 实时绘制，使用 mpv 播放本地音乐。支持中文和英文界面、六语言大字、暂停、定位与片段循环。

## 环境要求

- Node.js 24 与 npm。
- mpv，且能在终端中执行 `mpv`。
- 至少 **130 列 × 35 行** 的终端，推荐全屏使用 **160 列 × 45 行** 或更大的画布。
- 支持中文、韩文的等宽字体，例如 DejaVu Sans Mono 搭配 Noto CJK 字体。

Ubuntu／Debian 可安装播放器和参考字体：

```bash
sudo apt install mpv fonts-dejavu-core fonts-noto-cjk
```

## 安装

```bash
git clone https://github.com/tmgr-1/world.execute-me-_ascii_art_video.git
cd world.execute-me-_ascii_art_video
npm ci
```

## 播放

自行准备歌曲的本地音乐文件，通过 `--music-file` 指定路径：

```bash
npm run play -- --music-file "./world.execute (me) ; - Mili.mp3" --lang cn --rehearsal
```

看到就绪画面后按 **Enter** 开始。将 `--lang cn` 改为 `--lang en` 可使用英文界面。路径中含空格时保留引号。

程序按终端实际行列铺满画面。窗口缩小到最低尺寸以下时会暂停播放，调整窗口后按空格继续。

| 按键 | 操作 |
|---|---|
| Enter | 开始播放 |
| Space | 暂停／继续 |
| q、Esc、Ctrl+C | 退出并恢复终端 |
| ← / → | 前后定位 5 秒 |
| ↑ / ↓ | 调整画面偏移 20 ms |
| [ / ] | 前后跳转一个歌词节点 |

从指定位置开始：

```bash
npm run play -- --music-file "./world.execute (me) ; - Mili.mp3" --rehearsal --seek 01:14
```

循环播放一个片段：

```bash
npm run play -- --music-file "./world.execute (me) ; - Mili.mp3" --rehearsal --loop 02:38..02:46
```

其他常用选项：

| 参数 | 用途 |
|---|---|
| `--offset-ms 80` | 让画面提前 80 ms；负值使画面延后 |
| `--speed 0.5` | 调整播放速度，范围为 0.25–2 |
| `--no-color` | 使用无彩色显示 |
| `--mpv-path /path/to/mpv` | 指定播放器路径 |
| `--hold-end` | 音乐结束后保留画面，按 q 退出 |

运行时不需要 Python、PyTorch、Whisper 或网络连接。

## 许可证

项目源码与原创文档采用 **GNU GPL v3**（`GPL-3.0-only`）。完整许可证见 [LICENSE](LICENSE)，相关声明见 [NOTICE](NOTICE)。

歌曲及歌词属于 Mili，项目不提供音乐文件。第三方依赖和字模保留各自许可，字模来源见[资产说明](films/world-execute/assets/README.md)。

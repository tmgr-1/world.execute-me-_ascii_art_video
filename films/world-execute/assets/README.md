# 字模来源

`glyphs.json` 是直接供字符画布读取的固定笔画资产。播放时不读取字体、不生成位图。

- `Ein`、`dos`、`trois`、`Fem`、`PROGRAM`、`PROCESS`、`TERMINATED`：本项目原创 5×7 字模，CC0-1.0。终止标题额外复制纵向像素行以适应前景。
- `네`、`六`、`终止`、`程序`、`已被终止`、`程序已被终止` 及其尺寸变体：使用系统 Noto Sans CJK SC 生成，字体许可证为 SIL Open Font License 1.1；[字体项目及许可证](https://github.com/notofonts/noto-cjk/blob/main/LICENSE)。项目不打包原字体。
- 中文终止标题采用六字单行整句字模：`.compact` 为 125×12（10 px 字体、1 列字间距），主字模为 154×14（12 px、2 列间距），`.large` 为 214×18（17 px、2 列间距），`.xlarge` 为 250×20（20 px、2 列间距）。渲染时选择可完整容纳的最大原生尺寸；最低画布与已确认的控制台预览一致。英文主标题由 `PROCESS`、`TERMINATED` 两份独立字模分两行居中绘制。
- 每个资产保留 `sourceText`、`sourceFont` 和许可证信息；中文、韩文为独立完整字模，未转写成 `6` 或 `ne`。

复现：`uv run --no-sync python tools/make_glyphs.py`。开发工具需要 Pillow 与系统 Noto CJK 字体，正式播放不需要它们。

# 字模来源

`glyphs.json` 是直接供字符画布读取的固定笔画资产。播放时不读取字体、不生成位图。

- `Ein`、`dos`、`trois`、`Fem`、`TERMINATED`：本项目原创 5×7 字模，CC0-1.0。终止标题额外复制纵向像素行以适应前景。
- `네`、`六`、`终止`：使用系统 Noto Sans CJK SC 生成，字体许可证为 SIL Open Font License 1.1；[字体项目及许可证](https://github.com/notofonts/noto-cjk/blob/main/LICENSE)。项目不打包原字体。
- 每个资产保留 `sourceText`、`sourceFont` 和许可证信息；中文、韩文为独立完整字模，未转写成 `6` 或 `ne`。

复现：`uv run --no-sync python tools/make_glyphs.py`。开发工具需要 Pillow 与系统 Noto CJK 字体，正式播放不需要它们。

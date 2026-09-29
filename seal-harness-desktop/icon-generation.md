# Seal Harness 小海豹原图

- 候选：A1，一次生成的独立图像；位于左下角。
- 工具：Codex 内置 `image_gen`（工具未暴露具体模型名），约束写在主提示词中。
- 原图：`assets/app-icon.png`，原生尺寸 `1254 × 1254`，生成字节未重采样。
- 色彩：海玻璃青绿纯色背景；海豹以暖象牙白和深蓝灰两组颜色组成，面部标记复用深蓝灰。
- 造型：大头、圆润双鳍和简化表情，优先保证小尺寸可辨认。其他尺寸、托盘和原生格式由 `scripts/export-product-icons.py` 导出。

生成提示词要求完整方形画面，海豹从左下角出现并占画面约 85–95%，由 4–7 个大形状组成，保留双鳍，背景覆盖所有空白区域。约束原文：

> no text or watermark, no borders, frames, cards, extra subjects or scenery, no fragile lines, sharp tips, unnecessary outlines, tiny details, decorative marks, photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform with no texture, vignette, or lighting variation.

图像生成是一次创意抽样；后续导出仅用于满足操作系统和应用资源格式。所有派生文件的 SHA256 见 `icon-provenance.json`。

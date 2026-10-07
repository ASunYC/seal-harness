"""从已生成的海豹原图导出各平台资源；需要 Pillow。"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SOURCE = ASSETS / "app-icon.png"
SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)


def save_png(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(path, format="PNG")


def main() -> None:
    original = Image.open(SOURCE).convert("RGBA")
    if original.width != original.height:
        raise ValueError("app-icon.png 必须是正方形")
    if original.getpixel((0, 0))[3] != 0 or original.getpixel((original.width - 1, 0))[3] != 0:
        raise ValueError("app-icon.png 的背景必须透明")

    # 保留透明背景的原图字节；派生文件可随时重建。
    save_png(original, ASSETS / "app-icon-mac.png", 1024)
    icons = ASSETS / "icons"
    for size in SIZES:
        save_png(original, icons / f"{size}x{size}.png", size)
    original.save(ASSETS / "app-icon.ico", format="ICO", sizes=[(size, size) for size in SIZES if size <= 256])
    original.save(ASSETS / "app-icon.icns", format="ICNS")

    mask = original.getchannel("A")
    tray = original
    for size, name in ((16, "tray-icon-blue.png"), (20, "tray-icon-blue@1.25x.png"),
                       (24, "tray-icon-blue@1.5x.png"), (32, "tray-icon-blue@2x.png")):
        save_png(tray, ASSETS / name, size)
    template = Image.new("RGBA", original.size, (0, 0, 0, 0))
    template.putalpha(mask)
    save_png(template, ASSETS / "tray-iconTemplate.png", 16)
    save_png(template, ASSETS / "tray-iconTemplate@2x.png", 32)
    tray_png = ASSETS / "tray-icon-blue@2x.png"
    encoded = base64.b64encode(tray_png.read_bytes()).decode("ascii")
    (ASSETS / "tray-icon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
        f'<image width="32" height="32" href="data:image/png;base64,{encoded}"/></svg>\n',
        encoding="utf-8",
    )

    files = {str(path.relative_to(ASSETS)).replace("\\", "/"): {
        "source": "assets/app-icon.png",
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    } for path in sorted(ASSETS.rglob("*")) if path.is_file()}
    record = {
        "sourceProject": "Seal Harness",
        "source": "ip-as-logo 风格的海豹原图经透明背景编辑；透明原图字节保存为 assets/app-icon.png",
        "files": files,
        "derived": "Platform PNG, ICO, ICNS and tray resources are generated from transparent app-icon.png with Pillow/Lanczos; the source PNG bytes remain unchanged during export.",
    }
    (ROOT / "icon-provenance.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"导出 {len(files)} 个 Seal Harness 图标资源")


if __name__ == "__main__":
    main()

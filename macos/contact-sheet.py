import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: python3 contact-sheet.py <shots dir> <out png> [title]")
        return 2
    shots = Path(sys.argv[1])
    out = Path(sys.argv[2])
    title = sys.argv[3] if len(sys.argv) > 3 else shots.name
    files = sorted(p for p in shots.glob("*.png") if p.stat().st_size > 0 and not p.name.startswith("screen-"))
    if not files:
        print("no shots to put on the sheet")
        return 1
    columns = 6
    thumb_w = 360
    label_h = 22
    try:
        font = ImageFont.load_default(size=14)
        head = ImageFont.load_default(size=22)
    except TypeError:
        font = ImageFont.load_default()
        head = font
    thumbs = []
    for file in files:
        with Image.open(file) as image:
            image = image.convert("RGB")
            ratio = thumb_w / image.width
            thumbs.append((file.stem, image.width, image.height, image.resize((thumb_w, max(1, round(image.height * ratio))), Image.LANCZOS)))
    cell_h = max(t[3].height for t in thumbs) + label_h + 8
    rows = (len(thumbs) + columns - 1) // columns
    top = 44
    sheet = Image.new("RGB", (columns * (thumb_w + 8) + 8, top + rows * cell_h + 8), (24, 24, 27))
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 10), f"{title}  ({len(thumbs)} screens)", fill=(230, 230, 233), font=head)
    for index, (name, width, height, image) in enumerate(thumbs):
        x = 8 + (index % columns) * (thumb_w + 8)
        y = top + (index // columns) * cell_h
        sheet.paste(image, (x, y))
        draw.text((x + 2, y + image.height + 3), f"{name}  {width}x{height}", fill=(200, 200, 205), font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, optimize=True)
    print(f"contact sheet {out} {sheet.width}x{sheet.height} from {len(thumbs)} shots")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Generate the SnapFire application icon (PNG + multi-size ICO).

Run from the project root:
    python scripts/make-icon.py
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
CENTER = SIZE / 2
AMBER = (255, 164, 43, 255)
AMBER_BRIGHT = (255, 197, 107, 255)
AMBER_DIM = (255, 164, 43, 150)


def background() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            dx = x - CENTER
            dy = y - CENTER
            distance = min(1.0, math.hypot(dx, dy) / (SIZE * 0.58))
            r = int(22 * (1 - distance) + 6 * distance)
            g = int(29 * (1 - distance) + 8 * distance)
            b = int(33 * (1 - distance) + 10 * distance)
            pixels[x, y] = (r, g, b, 255)

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [18, 18, SIZE - 18, SIZE - 18], radius=200, fill=255
    )
    rounded = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    rounded.paste(image, (0, 0), mask)
    return rounded


def geometry(draw: ImageDraw.ImageDraw, width: int, color: tuple[int, int, int, int]) -> None:
    # Pointy-top hexagon.
    radius = 330
    points = []
    for index in range(6):
        angle = math.radians(-90 + index * 60)
        points.append((CENTER + math.cos(angle) * radius, CENTER + math.sin(angle) * radius))
    draw.line(points + [points[0]], fill=color, width=width, joint="curve")

    # Center ring.
    ring = 150
    draw.ellipse(
        [CENTER - ring, CENTER - ring, CENTER + ring, CENTER + ring],
        outline=color,
        width=width,
    )

    # Crosshair ticks.
    tick_inner = 195
    tick_outer = 275
    half = width / 2
    draw.line(
        [(CENTER, CENTER - tick_outer), (CENTER, CENTER - tick_inner)],
        fill=color,
        width=width,
    )
    draw.line(
        [(CENTER, CENTER + tick_inner), (CENTER, CENTER + tick_outer)],
        fill=color,
        width=width,
    )
    draw.line(
        [(CENTER - tick_outer, CENTER), (CENTER - tick_inner, CENTER)],
        fill=color,
        width=width,
    )
    draw.line(
        [(CENTER + tick_inner, CENTER), (CENTER + tick_outer, CENTER)],
        fill=color,
        width=width,
    )
    draw.ellipse(
        [CENTER - 28 - half, CENTER - 28 - half, CENTER + 28 + half, CENTER + 28 + half],
        fill=color,
    )


def build_icon() -> Image.Image:
    image = background()

    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    geometry(ImageDraw.Draw(glow), 34, AMBER_DIM)
    glow = glow.filter(ImageFilter.GaussianBlur(34))
    image = Image.alpha_composite(image, glow)

    crisp = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    geometry(ImageDraw.Draw(crisp), 20, AMBER)
    image = Image.alpha_composite(image, crisp)

    # Thin rim highlight around the rounded square.
    rim = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(
        [22, 22, SIZE - 22, SIZE - 22],
        radius=198,
        outline=(255, 197, 107, 80),
        width=6,
    )
    image = Image.alpha_composite(image, rim)

    # Soft top highlight.
    highlight = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(highlight).ellipse(
        [-220, -520, SIZE + 220, 430], fill=(255, 220, 160, 28)
    )
    highlight = highlight.filter(ImageFilter.GaussianBlur(90))
    image = Image.alpha_composite(image, highlight)
    return image


def main() -> None:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build_dir = os.path.join(root, "build")
    public_dir = os.path.join(root, "src", "renderer", "public")
    os.makedirs(build_dir, exist_ok=True)
    os.makedirs(public_dir, exist_ok=True)

    icon = build_icon()
    icon_256 = icon.resize((256, 256), Image.LANCZOS)
    icon_png = os.path.join(build_dir, "icon.png")
    icon_ico = os.path.join(build_dir, "icon.ico")
    icon_256.save(icon_png, "PNG")
    icon_256.save(
        icon_ico,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    icon_256.save(os.path.join(public_dir, "icon.png"), "PNG")
    print("wrote", icon_png)
    print("wrote", icon_ico)
    print("wrote", os.path.join(public_dir, "icon.png"))


if __name__ == "__main__":
    main()

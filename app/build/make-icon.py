"""
Keel's app icon, drawn rather than traced so it can be re-rendered at any size.

The mark is the same sailboat the app brands with in `shell/Icon.tsx` — a mast, one sail and a
hull — but solid instead of line art, because a 1.75px stroke disappears in a 16px dock tile.
Geometry is in a 1024 space and drawn at 4x, then downsampled, which is the anti-aliasing.

    python3 make-icon.py       ->  icon.png (1024, macOS-inset squircle)
                                   icon-flat.png (1024, full bleed, for .ico / Linux)

electron-builder turns icon.png into .icns and .ico at package time (buildResources: build).
"""
from PIL import Image, ImageDraw

S = 1024
F = 4                      # supersample factor
N = S * F

def px(v): return int(round(v * F))

def bezier(p0, p1, p2, steps=180):
    """Quadratic, sampled into a polyline."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return out

def gradient(size, top, bottom):
    """Vertical ramp, with a slight diagonal so the tile does not look flat."""
    g = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(g)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g

# the mark's own bounds in 1024-space, used to centre it in the tile
MARK = (232, 238, 802, 892)

def mark(draw, scale=1.0, dx=0.0, dy=0.0):
    """The sailboat, in 1024-space coordinates."""
    def P(x, y): return (px(x * scale + dx), px(y * scale + dy))
    W = (255, 255, 255, 255)

    # hull: a straight deck with a swept bottom
    hull = [P(232, 648), P(802, 648)] + [P(x, y) for x, y in bezier((802, 648), (517, 892), (232, 648))]
    draw.polygon(hull, fill=W)

    # sail: leech bows out to the right of the mast. Its head is flush with the masthead — a mast
    # standing proud of the sail reads as a pinhead once the icon is 16px in a dock.
    sail = [P(470, 238)] + [P(x, y) for x, y in bezier((470, 238), (704, 428), (748, 626))] + [P(470, 626)]
    draw.polygon(sail, fill=W)

    # mast, drawn last so it sits over the sail's luff
    draw.rounded_rectangle([P(452, 238), P(488, 656)], radius=px(8 * scale), fill=W)

def build(inset: bool, out: str):
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    box = 824 if inset else 1024                 # Apple's icon grid leaves the tile inset
    off = (1024 - box) / 2
    radius = box * 0.2245                        # macOS squircle, approximated

    tile = Image.new('RGBA', (px(box), px(box)), (0, 0, 0, 0))
    mask = Image.new('L', (px(box), px(box)), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, px(box) - 1, px(box) - 1], radius=px(radius), fill=255)
    tile.paste(gradient(px(box), (0x5B, 0x9B, 0xFF), (0x18, 0x3F, 0xC4)), (0, 0))
    tile.putalpha(mask)
    img.paste(tile, (px(off), px(off)), tile)

    glyph = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    # fit the mark to ~60% of the tile height and centre it, lifted a touch for optical balance
    mx0, my0, mx1, my1 = MARK
    scale = (box * 0.60) / (my1 - my0)
    dx = off + box / 2 - (mx0 + mx1) / 2 * scale
    dy = off + box / 2 - (my0 + my1) / 2 * scale - box * 0.015
    mark(ImageDraw.Draw(glyph), scale=scale, dx=dx, dy=dy)
    img.alpha_composite(glyph)

    img.resize((S, S), Image.LANCZOS).save(out)
    print('wrote', out)

build(True, 'icon.png')
build(False, 'icon-flat.png')

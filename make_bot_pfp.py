"""CapiTracker Telegram bot avatar (512x512 PNG).

Uses the REAL brand assets, matched to the browser:
  - the gold emblem from logo_b64.txt
  - "CapiTracker" in a serif (Georgia = the CSS fallback for IBM Plex Serif)
  - the slogan "To Keep the Budget Lekker", uppercase + letter-spaced
  - navy #1B2540 sampled straight from the emblem
Rendered at 4x then downsampled for clean edges. Telegram crops to a circle,
so the lockup is kept inside a safe radius.
"""
import base64, struct
from PIL import Image, ImageDraw, ImageFont

SS = 4
S = 512 * SS
C = S // 2

NAVY   = (27, 37, 64)      # #1B2540  — sampled from the emblem background
CREAM  = (244, 238, 224)   # wordmark
GOLD   = (210, 170, 86)    # slogan — muted brand gold

F_SERIF = "C:/Windows/Fonts/georgia.ttf"
F_SANS  = "C:/Windows/Fonts/arialbd.ttf"   # slogan: clean tracked caps

# --- decode the real emblem ---
_raw = base64.b64decode(open("logo_b64.txt").read().strip())
open("_logo_decoded.png", "wb").write(_raw)
_src = Image.open("_logo_decoded.png").convert("RGB")


def _key_navy(src):
    """Return the emblem as RGBA with its navy background keyed to transparent,
    so only the gold mark (and sparkle) composite onto our flat navy canvas.
    Alpha ramps with distance from the background navy for feathered edges."""
    out = src.convert("RGBA")
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = abs(r - 27) + abs(g - 37) + abs(b - 64)
            a = 0 if d <= 26 else (255 if d >= 130 else round((d - 26) / 104 * 255))
            px[x, y] = (r, g, b, a)
    return out


EMBLEM = _key_navy(_src)


def fit_font(path, text, target_w, lo=10, hi=400):
    """Largest font size whose text width <= target_w."""
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    best = lo
    while lo <= hi:
        mid = (lo + hi) // 2
        f = ImageFont.truetype(path, mid)
        b = probe.textbbox((0, 0), text, font=f)
        if (b[2] - b[0]) <= target_w:
            best = mid; lo = mid + 1
        else:
            hi = mid - 1
    return ImageFont.truetype(path, best)


def draw_centered(d, cx, y, text, font, fill):
    b = d.textbbox((0, 0), text, font=font)
    d.text((cx - (b[2] - b[0]) / 2 - b[0], y), text, font=font, fill=fill)
    return b[3] - b[1]


def draw_tracked(d, cx, y, text, font, fill, track):
    """Centered text with letter-spacing (track px between glyphs)."""
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + track * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += w + track


def build(emblem_h, word_w, word_y, slogan_px, track, out):
    img = Image.new("RGB", (S, S), NAVY)
    d = ImageDraw.Draw(img)

    # emblem — scaled to emblem_h tall, centered, near the top. Its own
    # background is the same navy, so it drops in seamlessly.
    ew, eh = EMBLEM.size
    h = emblem_h * SS
    w = round(ew * h / eh)
    em = EMBLEM.resize((w, h), Image.LANCZOS)
    ey = 70 * SS
    img.paste(em, (C - w // 2, ey), em)   # use emblem alpha as the mask

    # wordmark
    wf = fit_font(F_SERIF, "CapiTracker", word_w * SS)
    draw_centered(d, C, word_y * SS, "CapiTracker", wf, CREAM)

    # slogan (uppercase, tracked)
    sf = ImageFont.truetype(F_SANS, slogan_px * SS)
    draw_tracked(d, C, (word_y + 66) * SS, "TO KEEP THE BUDGET LEKKER", sf, GOLD, track * SS)

    img.resize((512, 512), Image.LANCZOS).save(out)
    print("wrote", out)


# Primary: full browser lockup — emblem + wordmark + slogan
build(emblem_h=190, word_w=360, word_y=300, slogan_px=22, track=4,
      out="capitracker_bot_pfp.png")

# Alt: larger emblem, tighter — reads better once Telegram circle-crops it
build(emblem_h=230, word_w=300, word_y=330, slogan_px=20, track=3,
      out="capitracker_bot_pfp_alt.png")

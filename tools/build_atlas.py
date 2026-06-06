#!/usr/bin/env python3
"""
MeowDesk asset preprocessor
===========================

The two source sprite sheets have very different, irregular layouts:

  * Oreo Cat  -> one animation per ROW, but rows have variable height/spacing
                 and frames are separated by transparent columns (not a fixed grid).
  * PACK cats -> a clean 14x72 grid of 64x64 cells, frames left-packed per row,
                 one animation per row. (cat 1 = black, cat 2 = ginger, cat 3 = white)

Rendering directly from those raw sheets at runtime would mean dealing with
per-frame coordinates and jitter. Instead this tool does the messy work ONCE
and emits clean, predictable output that the Electron renderer can trust:

  assets/generated/<cat>/<state>.png   horizontal strip, each frame 64x64
  assets/generated/manifest.json       per-cat / per-state metadata (fps, frames, loop...)
  assets/generated/tray.png (+@2x)     little cat face for the macOS menu-bar icon

Normalization rules (so every cat is the same on-screen size and stands on the
same ground line, and so jumps still visibly rise):
  * Each cat gets ONE scale factor derived from its walk pose height, so a
    walking Oreo and a walking PACK cat end up about the same pixel height.
  * Within an animation, the lowest content point = the "ground". Each frame is
    bottom-aligned to a fixed baseline, but frames whose content sits higher than
    the ground (mid-jump) are raised accordingly -> vertical motion is preserved.
  * Every frame is centered horizontally in a 64x64 cell.

Run:  python3 tools/build_atlas.py   (or: npm run build:assets)
"""

import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OREO_PNG = os.path.join(ROOT, "assets/Oreo/Oreo Cat - Aichan_owo/Sprite Sheet Cat - Aichan_owo.png")
PACK = {
    # color name -> clean 64x64 sheet
    "black":  os.path.join(ROOT, "assets/PACK/PACK/cat 1 (64Â64).png"),
    "ginger": os.path.join(ROOT, "assets/PACK/PACK/cat 2 (64Â64).png"),
    "white":  os.path.join(ROOT, "assets/PACK/PACK/cat 3 (64Â64).png"),
}
OUT_DIR = os.path.join(ROOT, "assets/generated")

# --- Output geometry -------------------------------------------------------
CELL = 64           # output frame is CELL x CELL
GROUND_Y = 60       # y of the baseline (cat's feet) inside the cell
TARGET_STAND = 40   # a standing/walking cat is normalized to ~this many px tall

# --- Per-state playback parameters (shared by all cats) --------------------
# loop: keep playing; once: play through then the app reverts to a base state.
STATE_PARAMS = {
    "idle":     {"fps": 6,  "loop": True},
    "walk":     {"fps": 10, "loop": True},
    "sleep":    {"fps": 4,  "loop": True},
    "react":    {"fps": 10, "loop": True},
    "thinking": {"fps": 5,  "loop": True},
    "happy":    {"fps": 12, "loop": False},
    "stretch":  {"fps": 8,  "loop": False},
    "tired":    {"fps": 3,  "loop": True},
}


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------
def content_bbox(img, x0, y0, x1, y1):
    """Tight bounding box of non-transparent pixels within [x0,x1) x [y0,y1).
    Returns (left, top, right, bottom) in absolute image coords, or None."""
    px = img.load()
    minx = miny = 10**9
    maxx = maxy = -1
    for y in range(y0, y1):
        for x in range(x0, x1):
            if px[x, y][3] != 0:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return (minx, miny, maxx + 1, maxy + 1)


def normalize_frame(src_crop, ground_src_bottom, frame_bbox_bottom, scale):
    """Place one already-cropped frame onto a CELL x CELL transparent canvas.

    src_crop          : tightly-cropped PIL image of just this frame's content
    ground_src_bottom : the animation's lowest content y (source px) = ground
    frame_bbox_bottom : this frame's content bottom y (source px)
    scale             : per-cat scale factor
    """
    w, h = src_crop.size
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    scaled = src_crop.resize((sw, sh), Image.NEAREST)

    # How far this frame floats above the ground (e.g. mid-jump), in output px.
    raise_out = round((ground_src_bottom - frame_bbox_bottom) * scale)

    canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    left = round((CELL - sw) / 2)
    bottom = GROUND_Y - raise_out
    top = bottom - sh
    canvas.alpha_composite(scaled, (left, top))
    return canvas


def save_strip(frames, out_path):
    """Compose a list of CELL x CELL frames into one horizontal strip PNG."""
    strip = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.alpha_composite(f, (i * CELL, 0))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    strip.save(out_path)


# ---------------------------------------------------------------------------
# Oreo sheet: detect rows (bands) then frames-within-row by transparent gaps
# ---------------------------------------------------------------------------
def detect_bands(img):
    """Return [(y0, y1_exclusive)] for each horizontal band of content."""
    W, H = img.size
    px = img.load()

    def row_empty(y):
        return all(px[x, y][3] == 0 for x in range(W))

    bands, y = [], 0
    while y < H:
        if not row_empty(y):
            start = y
            while y < H and not row_empty(y):
                y += 1
            bands.append((start, y))
        else:
            y += 1
    return bands


def detect_segments(img, y0, y1):
    """Return [(x0, x1_exclusive)] of frames within a band (split on empty cols)."""
    W, _ = img.size
    px = img.load()

    def col_empty(x):
        return all(px[x, y][3] == 0 for y in range(y0, y1))

    segs, x = [], 0
    while x < W:
        if not col_empty(x):
            start = x
            while x < W and not col_empty(x):
                x += 1
            segs.append((start, x))
        else:
            x += 1
    return segs


# Oreo band index (0-based, in sheet order) -> our state name.
# (band order: 0 StandToSit 1 SitIdle 2 SitToStand 3 StandToSleep 4 SleepIdle
#  5 SleepToStand 6 StandIdle 7 Eat 8 Walk 9 Run 10 PrepStealth 11 Stealth
#  12 CancelStealth 13 Jump 14 Attack 15 LoopAttack 16 JumpInBox 17 PushUp
#  18 PlayBox 19 PushDown 20 EarUp 21 Scan 22 EarDown 23 JumpOutBox)
OREO_MAP = {
    "idle":     6,   # Stand Idle
    "walk":     8,   # Walk
    "sleep":    4,   # Sleep Idle
    "react":    7,   # Eat (hearts = excited) -> typing reaction
    "thinking": 10,  # Prepare stealth (focused, alert crouch, wide eyes locked on)
    "happy":    13,  # Jump (a little hop)
    "stretch":  5,   # Sleep -> Stand (waking up + stretch)
    "tired":    1,   # Sit Idle (slumped)
}


def build_oreo():
    img = Image.open(OREO_PNG).convert("RGBA")
    bands = detect_bands(img)
    if len(bands) != 24:
        print(f"  ! warning: expected 24 Oreo bands, found {len(bands)}")

    # Per-band frame crops with their tight bboxes.
    band_frames = []  # list per band of [(crop, bbox), ...]
    for (y0, y1) in bands:
        segs = detect_segments(img, y0, y1)
        frames = []
        for (x0, x1) in segs:
            bb = content_bbox(img, x0, y0, x1, y1)
            if bb is None:
                continue
            frames.append((img.crop(bb), bb))
        band_frames.append(frames)

    # Scale from the walk band so Oreo matches PACK cats in size.
    walk_band = band_frames[OREO_MAP["walk"]]
    walk_h = max(bb[3] - bb[1] for _, bb in walk_band)
    scale = TARGET_STAND / walk_h

    states = {}
    for state, bidx in OREO_MAP.items():
        frames = band_frames[bidx]
        ground = max(bb[3] for _, bb in frames)  # lowest content point in band
        out_frames = [normalize_frame(crop, ground, bb[3], scale) for crop, bb in frames]
        save_strip(out_frames, os.path.join(OUT_DIR, "oreo", f"{state}.png"))
        states[state] = {
            "file": f"oreo/{state}.png",
            "frames": len(out_frames),
            **STATE_PARAMS[state],
        }
        print(f"    oreo/{state:9} {len(out_frames):2} frames")

    return {"frameSize": CELL, "nativeFacing": "right", "states": states}, scale


# ---------------------------------------------------------------------------
# PACK cats: fixed 64x64 grid, frames left-packed per row
# ---------------------------------------------------------------------------
# Row index -> state. Only the rows we are confident about; the renderer falls
# back for any missing state (thinking->idle, happy->walk, stretch->idle,
# tired->sleep). Sleep uses a slice of the long lie-down row.
PACK_ROW = {
    "idle":  (2, None),       # front standing idle
    "walk":  (4, None),       # side walk
    "react": (0, None),       # sitting / grooming reaction
    "sleep": (6, (6, None)),  # long lie-down+sleep row -> keep the settled tail
}


def row_frame_count(img, row):
    """How many left-packed 64px cells in this row contain pixels."""
    W, _ = img.size
    px = img.load()
    cols = W // CELL
    count = 0
    for cx in range(cols):
        filled = any(
            px[x, y][3] != 0
            for y in range(row * CELL, (row + 1) * CELL)
            for x in range(cx * CELL, (cx + 1) * CELL)
        )
        if filled:
            count += 1
        else:
            break  # frames are packed from the left with no gaps
    return count


def build_pack(color, path):
    img = Image.open(path).convert("RGBA")

    # Reference scale from the walk row's tallest frame.
    walk_row = PACK_ROW["walk"][0]
    n_walk = row_frame_count(img, walk_row)
    walk_h = 0
    for cx in range(n_walk):
        bb = content_bbox(img, cx * CELL, walk_row * CELL, (cx + 1) * CELL, (walk_row + 1) * CELL)
        if bb:
            walk_h = max(walk_h, bb[3] - bb[1])
    scale = TARGET_STAND / walk_h

    states = {}
    for state, (row, sl) in PACK_ROW.items():
        n = row_frame_count(img, row)
        idxs = list(range(n))
        if sl:
            a, b = sl
            idxs = idxs[a:(b if b is not None else n)]

        # Collect crops + bboxes, compute the ground for this row.
        crops = []
        ground = 0
        for cx in idxs:
            bb = content_bbox(img, cx * CELL, row * CELL, (cx + 1) * CELL, (row + 1) * CELL)
            if bb is None:
                continue
            crops.append((img.crop(bb), bb))
            ground = max(ground, bb[3])

        out_frames = [normalize_frame(crop, ground, bb[3], scale) for crop, bb in crops]
        save_strip(out_frames, os.path.join(OUT_DIR, color, f"{state}.png"))
        states[state] = {
            "file": f"{color}/{state}.png",
            "frames": len(out_frames),
            **STATE_PARAMS[state],
        }
        print(f"    {color}/{state:9} {len(out_frames):2} frames")

    return {"frameSize": CELL, "nativeFacing": "left", "states": states}


# ---------------------------------------------------------------------------
# Tray icon: crop a cat face from the ginger front-idle row, shrink to 16/32.
# ---------------------------------------------------------------------------
def build_tray():
    img = Image.open(PACK["ginger"]).convert("RGBA")
    # Row 1 frame 0 is a clean front-facing standing cat; take its upper half (head).
    bb = content_bbox(img, 0, 1 * CELL, CELL, 2 * CELL)
    head = img.crop((bb[0], bb[1], bb[2], bb[1] + (bb[3] - bb[1]) // 2 + 4))
    # square it
    w, h = head.size
    s = max(w, h)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.alpha_composite(head, ((s - w) // 2, (s - h) // 2))
    sq.resize((16, 16), Image.NEAREST).save(os.path.join(OUT_DIR, "tray.png"))
    sq.resize((32, 32), Image.NEAREST).save(os.path.join(OUT_DIR, "tray@2x.png"))
    print("    tray.png (16) + tray@2x.png (32)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {"frameSize": CELL, "groundY": GROUND_Y, "cats": {}}

    print("  Oreo:")
    oreo, _ = build_oreo()
    manifest["cats"]["oreo"] = oreo

    for color, path in PACK.items():
        print(f"  {color.capitalize()}:")
        manifest["cats"][color] = build_pack(color, path)

    print("  Tray:")
    build_tray()

    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n  manifest.json written ({len(manifest['cats'])} cats)")


if __name__ == "__main__":
    main()

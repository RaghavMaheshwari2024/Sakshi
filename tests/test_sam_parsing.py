"""SAM 3.1 stream -> Sakshi tracks, using a hand-built stream in Meta's grammar.

The mask payload is produced with the parser's own encoder, so this checks our
plumbing (cache replay, parser, box/mask placement, ground-contact point), not
Meta's codec.
"""

import asyncio
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from meta_sam_parser._mask_codec import _encode_raster  # noqa: E402

from sakshi.meta.sam import _parse, _replay, result_to_tracks  # noqa: E402


def _stream():
    w, h = 20, 10
    m = np.zeros((h, w), np.uint8)
    m[2:9, 3:17] = 1  # mask rows 2..8, cols 3..16
    payload = _encode_raster([int(v) for v in m.flatten()], w, h)
    lines = [
        f"<{i}f>0<|box;x1={100 + 5 * i};y1=200;x2={119 + 5 * i};y2=209;w=640;h=360|>"
        f"<|mask;x=0;y=0;data={h},{w},{payload}|>"
        for i in range(3)
    ]
    text = "\n".join(lines) + "\n"
    lane = {"item_id": "a", "output_index": 0, "content_index": 0}
    ev = [{"type": "response.output_text.delta", **lane, "delta": ln + "\n"} for ln in lines]
    ev += [{"type": "response.output_text.done", **lane, "text": text}, {"type": "response.completed", "response": {}}]
    return ev


def test_stream_to_tracks():
    res = asyncio.run(_parse(_replay(_stream())))
    assert not res.diagnostics
    tracks = result_to_tracks(res, "car")
    assert [t["id"] for t in tracks] == ["car-0"]
    f = tracks[0]["frames"]
    assert [x["i"] for x in f] == [0, 1, 2]
    # lowest mask row is 8 -> y = 200 + 8.5; columns 3..16 -> x = 100 + 10
    assert f[0]["contact_px"] == [110.0, 208.5] or tuple(f[0]["contact_px"]) == (110.0, 208.5)
    assert f[2]["contact_px"][0] == 120.0
    assert f[0]["area_px"] == 98



def test_rle_round_trip_and_paste():
    from sakshi.masks import paste_mask, rle_to_mask

    res = asyncio.run(_parse(_replay(_stream())))
    f = result_to_tracks(res, "car")[0]["frames"][0]
    local = rle_to_mask(f["rle"])
    expected = np.zeros((10, 20), np.uint8)
    expected[2:9, 3:17] = 1
    assert (local == expected).all()
    full = paste_mask((360, 640), f["box"], f["rle"])
    assert full.sum() == 98 and full[202:209, 103:117].all()

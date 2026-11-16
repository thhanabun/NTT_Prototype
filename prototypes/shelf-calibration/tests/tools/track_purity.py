"""Dev tool: are each camera's own tracker ids (ByteTrack) one person each? Truth calibration + GT, scoring only.
usage: track_purity.py <scenario> <rec.json>"""
import json, sys, collections
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent.parent
sc, recp = sys.argv[1:3]
t = json.load(open(HERE / "videos" / sc / "truth.json", encoding="utf-8")); rec = json.load(open(recp, encoding="utf-8"))
Hs = [np.array(c["H_img_to_floor_m"]) for c in t["cameras"]]
fr = t["gt_positions"]["frames"]; gt_t = np.array([f["t"] for f in fr])


def gt_at(sec):
    i = np.searchsorted(gt_t, sec); i0, i1 = max(0, i - 1), min(len(fr) - 1, i)
    a, b = {p["id"]: (p["x"], p["y"]) for p in fr[i0]["people"]}, {p["id"]: (p["x"], p["y"]) for p in fr[i1]["people"]}
    w = 0 if i0 == i1 else (sec - gt_t[i0]) / (gt_t[i1] - gt_t[i0])
    return {k: np.array([(1 - w) * a[k][0] + w * b[k][0], (1 - w) * a[k][1] + w * b[k][1]]) for k in a if k in b}


lab = collections.defaultdict(list)  # (cam, raw id) -> GT ids over time
for r in rec:
    g = gt_at(r["now"] / 1000)
    for ci, ppl in r["cams"].items():
        H = Hs[int(ci)]
        for p in ppl:
            if "id" not in p: continue
            b = p["box"]; q = H @ [(b[0] + b[2]) / 2, b[3], 1]; f = q[:2] / q[2]
            k, d = min(((k, np.linalg.norm(v - f)) for k, v in g.items()), key=lambda x: x[1])
            if d < .8: lab[(ci, p["id"])].append(k)
tot = good = 0; per_cam = collections.defaultdict(lambda: [0, 0, 0])
for (ci, rid), seq in lab.items():
    if len(seq) < 5: continue
    c = collections.Counter(seq).most_common(1)[0][1]; tot += len(seq); good += c; pc = per_cam[ci]; pc[0] += len(seq); pc[1] += c; pc[2] += 1
people_tracks = collections.defaultdict(set)
for (ci, rid), seq in lab.items():
    if len(seq) >= 5: people_tracks[(ci, collections.Counter(seq).most_common(1)[0][0])].add(rid)
print(f"purity (detections on the track's main person): {good / tot:.2f}")
for ci, (n, g, k) in sorted(per_cam.items()): print(f" cam{ci}: purity {g / n:.2f}, tracks {k}, tracks per person {np.mean([len(v) for (c, _), v in people_tracks.items() if c == ci]):.1f}")

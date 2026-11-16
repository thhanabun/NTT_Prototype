"""Dev tool: which appearance signature separates people best ACROSS cameras? Crops labelled by GT (truth used for scoring only).
A crop is labelled only when its feet are visible, one GT person is within 0.4 m and every other is > 1.2 m away.
usage: reid_eval.py <scenario> <rec.json> [max_crops_per_person_cam]"""
import json, sys, random, itertools, collections
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE.parent)); import server  # noqa: E402  (looks())
import openvino as ov

sc, recp = sys.argv[1:3]; cap_n = int(sys.argv[3]) if len(sys.argv) > 3 else 25
t = json.load(open(HERE / "videos" / sc / "truth.json", encoding="utf-8")); rec = json.load(open(recp, encoding="utf-8"))
Hs = [np.array(c["H_img_to_floor_m"]) for c in t["cameras"]]
fr = t["gt_positions"]["frames"]; gt_t = np.array([f["t"] for f in fr])
def gt_at(sec):
    i = np.searchsorted(gt_t, sec); i0, i1 = max(0, i - 1), min(len(fr) - 1, i)
    a, b = {p["id"]: (p["x"], p["y"]) for p in fr[i0]["people"]}, {p["id"]: (p["x"], p["y"]) for p in fr[i1]["people"]}
    w = 0 if i0 == i1 else (sec - gt_t[i0]) / (gt_t[i1] - gt_t[i0])
    return {k: np.array([(1 - w) * a[k][0] + w * b[k][0], (1 - w) * a[k][1] + w * b[k][1]]) for k in a if k in b}

want = collections.defaultdict(list)  # (cam, gt id) -> [(time, box)]
for r in rec:
    g = gt_at(r["now"] / 1000)
    for ci, ppl in r["cams"].items():
        boxes = [p["box"] for p in ppl]
        for k, b in enumerate(boxes):
            w = b[2] - b[0]
            if any(j != k and o[3] > b[3] + 3 and min(o[2], b[2]) - max(o[0], b[0]) > .3 * w and o[1] < b[3] for j, o in enumerate(boxes)): continue
            q = Hs[int(ci)] @ [(b[0] + b[2]) / 2, b[3], 1]; f = q[:2] / q[2]
            d = sorted((np.linalg.norm(v - f), k2) for k2, v in g.items())
            if d and d[0][0] < .4 and (len(d) < 2 or d[1][0] > 1.2): want[(int(ci), d[0][1])].append((r["now"] / 1000, b))
random.seed(1)
pick = {key: sorted(random.sample(v, min(cap_n, len(v)))) for key, v in want.items()}
core = ov.Core(); D = HERE.parent.parent / "NTT_Prototype/data/vision/reid"
nets = {m: core.compile_model(str(D / f"person-reidentification-retail-{m}.xml"), "CPU") for m in ("0277", "0286", "0287", "0288") if (D / f"person-reidentification-retail-{m}.xml").is_file()}
def emb(net, crop):
    _, _, h, w = net.input(0).shape; x = cv2.resize(crop, (w, h)).transpose(2, 0, 1)[None].astype(np.float32)
    v = net(x)[net.output(0)].ravel(); return v / (np.linalg.norm(v) + 1e-9)
items = []  # (cam, gt, {method: vec})
for ci in sorted({k[0] for k in pick}):
    cap = cv2.VideoCapture(str(HERE / "videos" / sc / t["cameras"][ci]["file"])); fps = cap.get(cv2.CAP_PROP_FPS) or t.get("fps", 25)
    todo = sorted((tt, gid, b) for (c, gid), v in pick.items() if c == ci for tt, b in v)
    for tt, gid, b in todo:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(tt * fps))); ok, img = cap.read()
        if not ok: continue
        x1, y1, x2, y2 = map(int, b); crop = img[max(0, y1):y2, max(0, x1):x2]
        if crop.size == 0: continue
        v = {"hist": np.array(server.looks(img, b) or [])}; v.update({m: emb(n, crop) for m, n in nets.items()})
        items.append((ci, gid, v))
print("labelled crops", len(items), "people", len({i[1] for i in items}), "cams", len({i[0] for i in items}))
def sim(m, a, b):
    if m.startswith("mix"):  # page appSim scales: re-ID (cos-.2)/.4, colour (bh-.65)/.25, mixed with weight w on colour
        w = float(m[3:]); e = float(a["0286"] @ b["0286"]); h = float(np.sqrt(a["hist"] * b["hist"]).sum() / 2) if len(a["hist"]) and len(b["hist"]) else None
        es = min(1, max(0, (e - .2) / .4)); return es if h is None else (1 - w) * es + w * min(1, max(0, (h - .65) / .25))
    if m == "hist": return float(np.sqrt(a * b).sum() / 2) if len(a) and len(b) else None
    return float(a @ b)
for m in ["hist", *nets, "mix0.25", "mix0.5"]:
    pos, neg = [], []
    for a, b in itertools.combinations(items, 2):
        if a[0] == b[0]: continue  # across cameras only
        s = sim(m, a[2], b[2]) if m.startswith("mix") else sim(m, a[2][m], b[2][m])
        if s is not None: (pos if a[1] == b[1] else neg).append(s)
    P, N = np.array(pos), np.array(neg); auc = (P[:, None] > N[None, :]).mean()
    # rank-1 across cameras: for each crop, is the most similar crop from another camera the same person?
    r1 = []
    for a in items:
        cand = [((sim(m, a[2], b[2]) if m.startswith("mix") else sim(m, a[2][m], b[2][m])), b[1]) for b in items if b[0] != a[0]]
        cand = [c for c in cand if c[0] is not None]
        if cand: r1.append(max(cand)[1] == a[1])
    print(f"{m:5s} cross-camera AUC {auc:.3f}  rank-1 {np.mean(r1):.2f}  same {P.mean():.2f} (p10 {np.percentile(P, 10):.2f}, p25 {np.percentile(P, 25):.2f})  different {N.mean():.2f} (p75 {np.percentile(N, 75):.2f}, p90 {np.percentile(N, 90):.2f}, p99 {np.percentile(N, 99):.2f})")

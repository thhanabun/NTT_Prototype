"""metrics.py <scenario> <dump.json> <out_metrics.json>: scores one run (truth used for scoring only)."""
import json, sys, numpy as np, collections
sys.path.insert(0, __import__('os').path.dirname(__file__)); import align_score as A
def _front_view(c):
    H = np.array(c["H_img_to_floor_m"], float).reshape(3, 3); w, h = c["size"]; X = H @ [w / 2, h, 1]; G = np.linalg.inv(H)
    return (G * np.sign((G @ (X / X[2]))[2]), c["size"])
sc, dump, out = sys.argv[1:4]; d = json.load(open(dump)); t = json.load(open(f"videos/{sc}/truth.json"))
json.dump({"fits": d["fits"]}, open("logs/_fits.json", "w"))
joint = A.main(sc, "logs/_fits.json"); shape = A.per_cam_shape(sc, "logs/_fits.json")
S = [s for s in d["samples"] if s["t"] is not None and s["t"] > 1 and s["people"]]
fr = t["gt_positions"]["frames"] if t.get("gt_positions") else None
gt_n = collections.Counter(len(f["people"]) for f in fr) if fr else None
gt_med = float(np.median([len(f["people"]) for f in fr])) if fr else None
counts = [len(s["people"]) for s in S]; pids = set(p["pid"] for s in S for p in s["people"])
_sj = json.load(open("scenarios.json", encoding="utf-8")); _sl = _sj if isinstance(_sj, list) else _sj["scenarios"]
n_real = gt_med or next((x.get("people_count_estimate") for x in _sl if x["id"] == sc), None)  # no per-frame truth: the scenario's stated count, never a made-up default
life = collections.Counter(p["pid"] for s in S for p in s["people"])
diff = [abs(c - n_real) for c in counts] if n_real else []
# per sample: the people any camera actually sees at that moment (feet in a picture or cut by its bottom edge), as in id_eval.py
views = [_front_view(c) for c in t["cameras"]]  # floor -> image, scaled so that points in front of the camera have q[2] > 0 (some truth H have the opposite overall sign: B1-09 lost 50 of 182 visible sightings)
def seen(x, y):
    for G, (w, h) in views:
        q = G @ [x, y, 1]
        if q[2] > 0 and 0 <= q[0] / q[2] <= w and 0 <= q[1] / q[2] <= 1.1 * h: return True
    return False
vis_diff = []
vc = t.get("visible_count_per_s")  # no per-person truth: a per-second count of the people the cameras show (Finding Video)
if not fr and vc:
    vt = np.array([v["t"] for v in vc])
    for s, c in zip(S, counts):
        k = int(np.argmin(abs(vt - s["t"])))
        # that count is detector-made (merged cameras over-count, MAE ~1): n_min = most people one camera sees is a lower bound.
        # "within 1" = inside [n_min - 1, n + 1]
        lo, hi = min(vc[k].get("n_min", vc[k]["n"]), vc[k]["n"]), max(vc[k].get("n_min", vc[k]["n"]), vc[k]["n"])  # merged n below one camera's own count is impossible (crowd over-merge, B1-06): the camera count is then the truth
        if abs(vt[k] - s["t"]) <= .6: vis_diff.append(0 if lo <= c <= hi else min(abs(c - lo), abs(c - hi)))
if fr:
    ft = np.array([f["t"] for f in fr])
    for s, c in zip(S, counts):
        k = int(np.argmin(abs(ft - s["t"])))
        if abs(ft[k] - s["t"]) <= .6: vis_diff.append(abs(c - sum(1 for q in fr[k]["people"] if seen(q["x"], q["y"]))))
m = {"alignment_joint": joint, "alignment_per_camera_shape_median_m": shape,
     "count_series": {"median": float(np.median(counts)), "max": max(counts), "truth_people_median": n_real, "frac_within1_of_truth": float(np.mean([x <= 1 for x in vis_diff])) if vis_diff else (float(np.mean([x <= 1 for x in diff])) if diff else None),
                      "frac_within1_of_median_truth": float(np.mean([x <= 1 for x in diff])) if diff else None},
     "ids": {"distinct_map_ids": len(pids), "real_people": n_real, "fragmentation_ratio": len(pids) / n_real if n_real else None, "ids_alive_in_over_half_samples": sum(1 for v in life.values() if v > len(S) / 2)},
     "cam_fit": [{"rms": f.get("rms"), "height": f.get("height")} for f in d["fits"]]}
json.dump(m, open(out, "w"), indent=1); print(json.dumps(m, indent=1))

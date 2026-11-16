"""Dev/scoring tool: how well map IDs follow real people (truth used for scoring only).
usage: id_eval.py <scenario> <run.json>   run.json = {"fits":[{"H":[9]}...], "samples":[{"t":s, "people":[{"pid","x","y"}]}]}
Steps: page map -> truth floor by one similarity (from the page's camera fits vs truth homographies, same as align_score),
then per GT frame (1 Hz) match page people to GT people (Hungarian, gate 1.0 m).
Reports per real person: share of their frames matched, distinct map IDs used (1 = perfect), switches; plus false map people."""
import json, os, sys, collections
from pathlib import Path
import numpy as np
from scipy.optimize import linear_sum_assignment

HERE = Path(__file__).resolve().parent.parent


def _front_view(c):
    H = np.array(c["H_img_to_floor_m"], float).reshape(3, 3); w, h = c["size"]; X = H @ [w / 2, h, 1]; G = np.linalg.inv(H)
    return (G * np.sign((G @ (X / X[2]))[2]), c["size"])
def apply(H, pts):
    H = np.array(H, float).reshape(3, 3); p = np.c_[pts, np.ones(len(pts))] @ H.T; return p[:, :2] / p[:, 2:3]


def similarity(P, T):
    best = None
    for flip in (1, -1):
        A = P * [1, flip]; ma, mb = A.mean(0), T.mean(0); X, Y = A - ma, T - mb
        U, S, Vt = np.linalg.svd(Y.T @ X / len(A)); d = np.sign(np.linalg.det(U @ Vt)); D = np.diag([1, d]); R = U @ D @ Vt
        s = (S * np.diag(D)).sum() / (X ** 2).sum() * len(A); t = mb - s * R @ ma
        err = np.median(np.linalg.norm(s * A @ R.T + t - T, axis=1))
        if best is None or err < best[0]: best = (err, lambda q, s=s, R=R, t=t, flip=flip: s * (np.asarray(q) * [1, flip]) @ R.T + t)
    return best


def main(sc, run_path, gate=1.0):
    truth = json.load(open(HERE / "videos" / sc / "truth.json", encoding="utf-8")); run = json.load(open(run_path, encoding="utf-8"))
    P, T = [], []
    for c, f in zip(truth["cameras"], run["fits"]):
        if not f.get("H"): continue
        w, h = c["size"]; g = np.array([[x, y] for x in np.linspace(.2 * w, .8 * w, 7) for y in np.linspace(.45 * h, .95 * h, 7)])
        P.append(apply(f["H"], g)); T.append(apply(c["H_img_to_floor_m"], g))
    align_err, to_truth = similarity(np.vstack(P), np.vstack(T))
    frames = truth["gt_positions"]["frames"]; samples = run["samples"]
    # a real person counts for recall only where at least one camera sees them (feet in the picture, or cut by its bottom edge):
    # cropped scenarios have people walking where no camera looks (B3-20: 20 % of person-frames), which no system can find.
    views = [_front_view(c) for c in truth["cameras"]]  # floor -> image, scaled so that points in front of the camera have q[2] > 0 (some truth H have the opposite overall sign: B1-09 lost 50 of 182 visible sightings)
    def seen(x, y):
        for G, (w, h) in views:
            q = G @ [x, y, 1]
            if q[2] > 0 and 0 <= q[0] / q[2] <= w and 0 <= q[1] / q[2] <= 1.1 * h: return True
        return False
    vis_total, vis_matched = 0, 0
    per = collections.defaultdict(lambda: {"frames": 0, "hit": 0, "pids": [], })
    false_pos, gt_total, matched_total = 0, 0, 0
    for fr in frames:
        s = min(samples, key=lambda s: abs(s["t"] - fr["t"])) if samples else None
        if not s or abs(s["t"] - fr["t"]) > .3: continue
        g = np.array([[p["x"], p["y"]] for p in fr["people"]]).reshape(-1, 2); gid = [p["id"] for p in fr["people"]]
        m = to_truth(np.array([[p["x"], p["y"]] for p in s["people"]]).reshape(-1, 2)) if s["people"] else np.zeros((0, 2))
        for i in gid: per[i]["frames"] += 1
        gt_total += len(gid); vis_total += sum(1 for q in g if seen(*q))
        if len(g) and len(m):
            C = np.linalg.norm(g[:, None] - m[None], axis=2); r, c = linear_sum_assignment(C)
            ok = [(i, j) for i, j in zip(r, c) if C[i, j] <= gate]
            vis_matched += sum(1 for i, j in ok if seen(*g[i]))
            for i, j in ok: per[gid[i]]["hit"] += 1; per[gid[i]]["pids"].append(s["people"][j]["pid"]); per[gid[i]].setdefault("tl", []).append((fr["t"], s["people"][j]["pid"]))
            matched_total += len(ok); false_pos += len(m) - len(ok)
        else:
            false_pos += len(m)
    people = {}
    for i, v in sorted(per.items()):
        seq = v["pids"]
        # A map id held for a single GT frame between two frames of the same other id is a matching blip (GT is 1 Hz and two people
        # stand within the 1 m gate), not an id change of the system: B1-01 run 5 had 3 such blips and 1 real swap. Real changes,
        # including short ones at the start or end and any id held >= 2 frames, still count. Raw numbers are kept as *_raw.
        clean = [p for k, p in enumerate(seq) if not (0 < k < len(seq) - 1 and seq[k - 1] == seq[k + 1] != p)]
        sw = lambda q: sum(1 for a, b in zip(q, q[1:]) if a != b)
        people[i] = {"frames": v["frames"], "found": round(v["hit"] / max(1, v["frames"]), 2), "ids": len(set(clean)), "switches": sw(clean),
                     "ids_raw": len(set(seq)), "switches_raw": sw(seq),
                     "main_id_share": round(collections.Counter(seq).most_common(1)[0][1] / max(1, len(seq)), 2) if seq else 0}
    out = {"scenario": sc, "map_to_truth_align_median_m": round(float(align_err), 2), "gt_people": len(people),
           "recall": round(vis_matched / max(1, vis_total), 2), "recall_all_gt": round(matched_total / max(1, gt_total), 2),
           "gt_visible_share": round(vis_total / max(1, gt_total), 2), "false_per_frame": round(false_pos / max(1, len(frames)), 2),
           "mean_ids_per_person": round(float(np.mean([p["ids"] for p in people.values()])), 2),
           "mean_ids_per_person_raw": round(float(np.mean([p["ids_raw"] for p in people.values()])), 2),
           "total_switches": sum(p["switches"] for p in people.values()), "total_switches_raw": sum(p["switches_raw"] for p in people.values()), "people": people}
    if os.environ.get("ID_TIMELINE"):  # per GT person: time and map id, only where the id changes
        for i, v in sorted(per.items()):
            tl = v.get("tl", []); print(i, [f"{t:.0f}s:{p}" for k, (t, p) in enumerate(tl) if k == 0 or tl[k - 1][1] != p])
    print(json.dumps(out, indent=1)); return out


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], *(float(x) for x in sys.argv[3:4]))

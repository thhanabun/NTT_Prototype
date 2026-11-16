"""Scoring only (truth never fed to the page). Inputs are JSON read from the page (people on map per time, cam fit info) and truth.json.
  align(map_pts_by_cam, truth_pts)  -> median/90% floor error per camera
  occlusion(count_series, truth_counts, merge_secs) -> pass if |count-truth|<=1 and no merge >2s
  idscore(tracks, gt) -> map IDs per real person, switches per person
Adapt field names once tests/scenarios.json + truth.json format is known."""
import json, sys, numpy as np
def align(pred, truth):
    e = np.linalg.norm(np.array(pred) - np.array(truth), axis=1); return {"median": float(np.median(e)), "p90": float(np.percentile(e, 90)), "pass": bool(np.median(e) <= 0.30)}
def agree(a, b):
    e = np.linalg.norm(np.array(a) - np.array(b), axis=1); return {"median": float(np.median(e)), "pass": bool(np.median(e) <= 0.40)}
def occlusion(counts, truth, merge_secs=0.0):
    d = np.abs(np.array(counts) - np.array(truth)); return {"max_diff": int(d.max()), "frac_within1": float((d <= 1).mean()), "pass": bool(d.max() <= 1 and merge_secs <= 2)}
def idscore(assign, n_real):
    """assign: {gt_person: [map_id per frame (None=missed)]}"""
    sw = {}; ids = set()
    for p, seq in assign.items():
        s = [x for x in seq if x is not None]; ids |= set(s); sw[p] = sum(1 for i in range(1, len(s)) if s[i] != s[i-1])
    return {"ratio": len(ids) / max(n_real, 1), "switches": sw, "pass": bool(len(ids) / max(n_real, 1) <= 1.5 and max(sw.values(), default=0) <= 1)}

"""score_run.py <scenario> <run-id e.g. B1-01-run4> <persisted tool-result file> <alignment_limit> : extract, score (alignment, count, id_eval), print summary + write logs/raw/<run>.metrics.json"""
import json, subprocess, sys, os
PY = sys.executable; here = os.path.dirname(os.path.abspath(__file__))
sc, run, src, lim = sys.argv[1:5]
os.chdir(os.path.dirname(here))
subprocess.check_call([PY, "-I", "harness/extract.py", src, f"logs/raw/{run}.dump.json"], stdout=subprocess.DEVNULL)
d = json.load(open(f"logs/raw/{run}.dump.json"))
json.dump({"samples": [{"t": s["t"], "people": s["people"]} for s in d["samples"] if s["t"] is not None], "fits": d["fits"]}, open(f"logs/raw/{run}.run.json", "w"))
subprocess.check_call([PY, "-I", "harness/metrics.py", sc, f"logs/raw/{run}.dump.json", f"logs/raw/{run}.metrics.json"], stdout=subprocess.DEVNULL)
m = json.load(open(f"logs/raw/{run}.metrics.json"))
try:
    e = json.loads(subprocess.check_output([PY, "-I", "tools/id_eval.py", sc, f"logs/raw/{run}.run.json"]))
    m["id_eval"] = {k: e[k] for k in ["map_to_truth_align_median_m", "gt_people", "recall", "false_per_frame", "mean_ids_per_person", "total_switches"]}
    m["id_eval"]["per_person"] = {k: [v["found"], v["ids"], v["switches"]] for k, v in e["people"].items()}
except Exception as ex: m["id_eval"] = {"error": str(ex)}
json.dump(m, open(f"logs/raw/{run}.metrics.json", "w"), indent=1)
json.dump(d["usage"], open(f"logs/raw/{run}.usage.json", "w"))
a = m["alignment_joint"]["overall_median"]; i = m["id_eval"]
print("alignment joint", round(a, 3), "limit", lim, "per-cam", {k: round(v["median_m"], 2) for k, v in m["alignment_joint"]["per_cam"].items()}, "shape", m["alignment_per_camera_shape_median_m"])
print("count", m["count_series"]); print("ids(own)", m["ids"]); print("id_eval", {k: v for k, v in i.items() if k != "per_person"}); print(i.get("per_person"))

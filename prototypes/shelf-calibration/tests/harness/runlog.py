"""Run logger: python runlog.py start <scenario> <batch> <cams> | fn <name> [params-json] | finish <metrics.json> <alignment> <occlusion> <id> | merge
Keeps tests/logs/<scenario>-run<k>.json and tests/function_usage_full_log.json."""
import json, sys, time, glob, os, collections
D = os.path.dirname(os.path.abspath(__file__)); T = os.path.dirname(D); L = os.path.join(T, "logs")
CUR = os.path.join(L, "_current.json")
now = lambda: time.strftime("%Y-%m-%dT%H:%M:%S")
def start(sc, batch, cams):
    k = len(glob.glob(os.path.join(L, f"{sc}-run*.json"))) + 1
    json.dump({"scenario": sc, "batch": batch, "cameras": int(cams), "run": k, "started": now(), "functions": []}, open(CUR, "w"))
def fn(name, params=None):
    r = json.load(open(CUR)); r["functions"].append({"order": len(r["functions"]) + 1, "name": name, "params": params, "t": now()})
    json.dump(r, open(CUR, "w"), ensure_ascii=False)
def finish(metrics, a, o, i):
    r = json.load(open(CUR)); r["finished"] = now()
    r["counts"] = dict(collections.Counter(f["name"] for f in r["functions"]))
    r["metrics"] = json.load(open(metrics)) if os.path.exists(metrics) else json.loads(metrics)
    r["pass"] = {"alignment": a == "1", "occlusion": o == "1", "id": i == "1"}
    r["verdict"] = "PASS" if all(r["pass"].values()) else "FAIL"
    json.dump(r, open(os.path.join(L, f"{r['scenario']}-run{r['run']}.json"), "w"), ensure_ascii=False, indent=1); os.remove(CUR)
def merge():
    runs = [json.load(open(p, encoding="utf-8")) for p in sorted(glob.glob(os.path.join(L, "*-run*.json")))]
    c = collections.Counter()
    for r in runs: c.update(r["counts"])
    json.dump({"runs": runs, "summary": {"totals": dict(c), "most_used": c.most_common(10), "rarely_used": [k for k, v in c.items() if v <= 2]}},
              open(os.path.join(T, "function_usage_full_log.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
if __name__ == "__main__":
    a = sys.argv[1:]; {"start": start, "fn": fn, "finish": finish, "merge": merge}[a[0]](*[json.loads(x) if a[0] == "fn" and i == 1 else x for i, x in enumerate(a[1:])])

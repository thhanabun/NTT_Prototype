"""finish_run.py <scenario> <usage.json (array of [order,t,name,params])> <metrics.json> <alignment 0/1> <occlusion 0/1> <id 0/1> [notes]
Writes tests/logs/<scenario>-run<k>.json from the page's window.usageLog (exact), and re-merges the full usage log."""
import json, sys, os, glob, collections, time
sys.path.insert(0, os.path.dirname(__file__)); import runlog
sc, usage, met, a, o, i = sys.argv[1:7]; notes = sys.argv[7] if len(sys.argv) > 7 else ""
cur = json.load(open(runlog.CUR)); u = json.load(open(usage)); u = json.loads(u) if isinstance(u, str) else u
fns = [{"order": x[0], "name": x[2], "params": x[3], "t": x[1]} for x in u]
cur.update(functions=fns, finished=runlog.now(), counts=dict(collections.Counter(f["name"] for f in fns)), metrics=json.load(open(met)),
           **{"pass": {"alignment": a == "1", "occlusion": o == "1", "id": i == "1"}})
cur["verdict"] = "PASS" if a == o == i == "1" else "FAIL"; cur["notes"] = notes
json.dump(cur, open(os.path.join(runlog.L, f"{sc}-run{cur['run']}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1); os.remove(runlog.CUR); runlog.merge(); print(cur["verdict"])

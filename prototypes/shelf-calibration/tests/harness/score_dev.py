"""score_dev.py <scenario> <name> [alignment_limit=0.30]
One call after `await th.run(name)`: reads tests/logs/dev/<name>.json (saved by the page, never pasted into chat), scores it
(alignment, count, id_eval via score_run.py) and prints a compact verdict line. Needs no tool-result file / padding trick."""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__)); T = os.path.dirname(here)
sc, name = sys.argv[1:3]; lim = sys.argv[3] if len(sys.argv) > 3 else "0.30"
src = os.path.join(T, "logs", "dev", name + ".json")
if not os.path.isfile(src): sys.exit("no dump: " + src)
out = subprocess.run([sys.executable, "-I", os.path.join(here, "score_run.py"), sc, name, src, lim], capture_output=True, text=True, encoding="utf-8")
if out.returncode: sys.exit(out.stderr[-800:])
m = json.load(open(os.path.join(T, "logs", "raw", name + ".metrics.json"))); a = m["alignment_joint"]["overall_median"]; i = m.get("id_eval", {})
print(f"{sc} {name}: align {a:.3f} m (limit {lim}) {'OK' if a <= float(lim) else 'FAIL'} | count {m['count_series']} | ids/person {i.get('mean_ids_per_person')} switches {i.get('total_switches')} recall {i.get('recall')}")
print("full text: " + os.path.join(T, "logs", "raw", name + ".metrics.json"))

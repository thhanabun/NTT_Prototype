"""python tests/harness/install_th.py  -> writes tests/logs/dev/th.json so the page can load the helper with one short call:
   eval((await (await fetch('/devlog/th')).json()).src)      (run again after editing th.js)"""
import json, os
D = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(os.path.dirname(D), "logs", "dev"); os.makedirs(out, exist_ok=True)
json.dump({"src": open(os.path.join(D, "th.js"), encoding="utf-8").read()}, open(os.path.join(out, "th.json"), "w"))
print("ok -> /devlog/th")

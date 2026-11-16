"""extract.py <persisted tool-result file> <out.json>: decode the page dump (usage log, samples, fits) saved by the browser tool."""
import json, sys
d = json.load(open(sys.argv[1]))
while isinstance(d, (str, list)):
    d = json.loads(d) if isinstance(d, str) else (json.loads(d[0]["text"]) if isinstance(d[0], dict) and "text" in d[0] else d)
    if isinstance(d, list) and not (d and isinstance(d[0], dict) and "text" in d[0]): break
d.pop("pad", None); json.dump(d, open(sys.argv[2], "w")); print({k: len(v) for k, v in d.items()})

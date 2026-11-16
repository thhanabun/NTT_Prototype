"""ctx_watch.py [limit_k=250]: context size of each recent Claude chat in this project, read from transcripts (costs no model tokens).
Writes tests/CONTEXT.md and prints only chats over the limit. Scheduler/main run it instead of calling get_usage per session."""
import json, os, sys, glob, time
lim = int(sys.argv[1]) if len(sys.argv) > 1 else 250
P = os.path.expanduser("~/.claude/projects/C--Users-User-OneDrive-Desktop-nttdata-cam")
rows = []
for f in sorted(glob.glob(P + "/*.jsonl"), key=os.path.getmtime, reverse=True)[:25]:
    if time.time() - os.path.getmtime(f) > 172800: continue
    ctx = t = None; title = ""
    for l in open(f, encoding="utf-8"):
        try: o = json.loads(l)
        except Exception: continue
        if o.get("type") == "custom-title": title = o.get("customTitle", title)
        m = o.get("message") or {}
        if not title and m.get("role") == "user" and isinstance(m.get("content"), str): title = m["content"][:50].replace("\n", " ")
        if m.get("role") == "assistant" and m.get("usage"):
            u = m["usage"]; ctx = (u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)) // 1000; t = o.get("timestamp", "")[:16]
    if ctx: rows.append((ctx, t, os.path.basename(f)[:8], title))
out = ["| ctx K | last call (UTC) | file | title |", "|---|---|---|---|"] + [f"| {c}{' **OVER**' if c > lim else ''} | {t} | {i} | {n} |" for c, t, i, n in rows]
open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CONTEXT.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
for c, t, i, n in rows:
    if c > lim: print(f"OVER {c}K {i} {n}")

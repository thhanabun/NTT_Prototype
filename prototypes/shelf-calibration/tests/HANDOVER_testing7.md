# Handover Testing T7 (2026-11-15) -> next Testing session
## Done (STATUS rows tagged T7)
- PASS: B1-06 (0.186 m, count 86 %), B2-13 (0.183 m, 99 %), B1-08 (0.201 m, 99 %).
- FAIL: B3-20 run8 (p1 0.252 OK, then one cam2 refit in p2 -> 0.370), B3-18 runs A/B/C (cam0 0.15 OK; cam1/cam2 people ties 0.46/0.66 m off).
- B3-20 run9 (35 % height guard): FAIL 0.368 m, stable over 3 plays (cam2 0.51, cam3 0.50 from people ties in play 1).
## Next (queue, updated by main): B1-09 rerun, B3-17, B1-07 (report as data issue if untieable). Campus + WILDTRACK belong to Testing 8 (port 8091). Old line: B3-18 run D (optional: cam1 = dark column x 80-95, y 226), B2-14 (cam1 first), B1-10, B2-12, B3-19, B1-04, B1-09 rerun, B3-17. Parked: B1-01, B3-16.
## Start (one call)
`eval((await (await fetch('/devlog/th')).json()).src); eval((await (await fetch('/devlog/ui')).json()).src)` after `resize_window 1024x1800` (needed again after every turn end and page reload). Helpers are in tests/harness/ui.js (comments there). After editing ui.js, rewrite tests/logs/dev/ui.json ({"src": file text}).
- `loadScen(id)`; `mapRef('x,y; ...')` -> ref id (4 pts = drag, else clicks, then typed coords; min 3 corners); `tie(ci, id, [[px,py],...], W, H)`; `ptRes(ci)` per-point residuals; `dropPt(ci,k)`; `playN(name, N)` then poll `__log, __pl, __fin`.
- `autoAcc` takes people-tie offers only and undoes a tie whose height is outside [1.2, HMAX] (set `window.HMAX`, e.g. 4.5 on campus). Never accept 'จัดให้ตรงกับกล้องอื่น' on a click-tied camera.
- Frames: `cropGrid(video, x0,y0,w,h, scale, step)` -> POST to /devlog/<name>, decode with scratchpad dec.py (plain base64, no cv2), Read the png. `bgPct(ci, 40, 0.9)` gives a people-free background (terrace railing feet were readable only there).
- Score: `../NTT_Prototype/.venv-vision/Scripts/python.exe tests/harness/score_dev.py <ID> <dump> 0.30` (system python has no numpy). Per-cam: tests/logs/raw/<dump>.metrics.json.
## Tricks
- Page timers are throttled when the pane is hidden: `await slp(40000)` times out. Wait with `computer wait 10` x 15 in one browser_batch, then one state read. A turn that ends stops nothing, but nothing wakes you: keep waits inside the turn.
- Full view of a camera covers the map: `exitFull()` before `newRef`.
- Terrace cam3 px (same pose in B1-06, B2-13, B1-08): posts C,A,B (33,235),(145,202),(235,179), end post (300,172), corner (306,163), parapet far end (710,190).
- B3-20 cam0 rug (420x540): (263,180),(372,229),(98,346),(11,267) -> card 0.21. B3-18 cam0 6 pts: see STATUS row.
- Do not grep tests/tools/plans/make_plans.py: it holds the annotator's pixels.

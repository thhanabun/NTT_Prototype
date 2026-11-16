# Handover Testing T9 (2026-11-15) -> next Testing session
## Done (STATUS rows tagged T9)
- FAIL: B3-20 run9 0.368 m (stable over 3 plays; cam2/cam3 people ties ~0.5 m off, no offers in p2/p3). B1-09 run3 0.355 m (shape per cam fine, group disagrees). B3-17 run7: cam0 0.14 m, cam1 not tied. B1-07: data issue, not run.
## Next
1. B1-09 again with cam1 P2 corrected: my P2 click (319,467) was ~60 px off along the rug edge (a foot hid the corner). On a people-free frame (`bgPct(1,30,0.5)`) the woven corner is near (257,494) in the 580x540 view. Other cam1 pts: P3 (553,329), V2 (541,300), V3 (319,231). cam0: P1,P2,P4 = (263,180),(372,229),(11,267).
2. B3-17 cam1 needs a 4th known floor point, or main must say why a 3-pt ref gives no fit (see STATUS row).
## Tricks learned
- One play takes ~4 min of wall time (2-cam ~1.5 min). Wait in ONE Bash call: venv python loop with time.sleep until tests/logs/dev/<name>-pN.json exists (timeout 600000). `computer wait` batches stop at ~180 s and cost more.
- Carpet identity in lab cam1 (looks toward +y): V1 = near bottom corner, V2 = far right, V3 = far apex, V9 = off-frame left. The step on the edge beside the rug is not in the plan.
- A custom ref of any known plan points works: `mapRef('x,y; ...')` with 3 or 4 points mixed from rug and carpet, then `tie`.
- Skip offers for click-tied cameras: `const o0=offr; offr=()=>o0().filter(b=>!/cam[01]\b/.test(b.parentElement.textContent))`.
- B3-17 cam1 is B1-09 cam1 squeezed in x (x317 ≈ 0.89·x109 + 85). Lab cam0 has the same pixels in B3-20, B1-09, B3-17.
- `dropPt` throws when the '<k> ✓' button is not found in full view; `ptRes` returned [] here.
- Frame decoder: scratchpad dec.py is gone with the session; 6 lines (JSON key -> base64 png).

# Handover: Testing System (written 2026-11-14 by Token Optimizer, from STATUS.md + the old session's last reports)

Read first: `../AUTOPLAN.md` (rules + pass criteria), `STATUS.md` (board), `../TOKEN_PLAN.md` §2 + §4 (how to test cheaply). Don't re-read the old session.

## State
- PASS: B1-02 (align 0.294 m), B1-03 (0.233 m). Streak 2.
- PARKED: B1-01 (6 runs; ties 0.3–0.4 m + one re-ID takeover between look-alikes). Must pass before the end.
- B1-05 PARTIAL: cam0 tied to the rug by 4 corners at plan size 2.2×3.7 → card avg **0.04 m**, height 3.2 m. cam1 sees only the blue carpet. **Next step:** draw the plan's 10-corner carpet polygon on the map (positions from `floorplan.json`), tie ≥4 of its corners in cam1 by eye (check against `floorplan.png`), then play ×3, clicking each offered "ใช้ค่านี้".
- B1-04: data issue (plan has only low-confidence slabs). Skip until Finding Video improves it.
- B1-09: cam0 by-eye rug corners give 0.37–0.48 m (rms 0.43, height 15.4 m). Not run. Retry with zoomed clicking; if still > 0.30 m, report as a precision blocker.
- B1-06 / B1-07 / B2-13 / B3-17: plans weak (no distinctive anchors). Try last.
- Not started: B1-07, B1-08, B1-10, all of batches 2 and 3.
- Suggested order: B1-05 → B1-08 → B1-10 → batch 2 (strong plans first) → B1-09 → weak ones.

## What works (learned)
- Views with a whole, clean rug in sight tie well (B1-02, B1-05 cam0). Failures came from references hidden, cut off, or low-confidence in the plan.
- Steady mode ("ตรวจทุก 1/8 วิ (คงที่)") stays ON for every scored run, so runs are repeatable.
- Accept only offered buttons ("ใช้ค่านี้", "ปรับจากคนเดิน", "จัดให้ตรงกับกล้องอื่น"). Never set values directly.
- Truth only for scoring; corners only by eye or the page's auto-corner tool.

## Cheap workflow per scenario (~25 calls instead of ~60)
1. Load the set: one batch (select set + wait), then `th.state()`.
2. Per camera: one small screenshot (scale 0.5), then ONE `browser_batch` of all corner clicks, then one zoom on the reference only. Check the card rms with `th.state()`.
3. `await th.run('<scn>-run<k>')` (one call, dump saved to the server), then `python tests/harness/score_dev.py <scn> <scn>-run<k> 0.30`.
4. `finish_run.py`, then a single row in STATUS.md, then a ≤5-line message to main.
- Helpers are untested end-to-end. If `th.run` or `score_dev` fails, use the old `score_run.py` path and tell main in one line.
- At ~250k context, finish the scenario, update this file, and tell main.

## Update (Testing session 2026-11-14, after floor-plan pass)
- Helpers th.state() works; th.run / score_dev.py NOT used (old path used). **BANNED since README item 25 (main): use the page's typed plan-metre fields instead; JS pixel placement runs are unscored.** Old note, for history only: map placement from plan worked: map = SVG #map, viewBox -6 -5 12 10, CSS scale k=min(w/12,h/10); screenshot factor 800/innerWidth; compute click px in JS, shift plan coords by (-5.5,-5.5). Drew B1-05 carpet 10-gon + rug this way (matched plan).
- Corner bar buttons shift right when the Reference dropdown label is wide: read their x from a screenshot, do not reuse fixed x.
- B1-05: cam0 rug tie 0.06 m (est. h 14.8 m, narrow strip) ; cam1 carpet corners hidden by people/soft -> data issue. B3-16: rug only a sliver in cam0 -> data issue. B1-04/06/09: see STATUS.md.
- Remaining untried by eye: B3-20, B2-15 (lab, plans 'high'), B2-12/B1-10/B2-14 (weak plans). Page keeps previous references after reload; ties reset on set load.

## Correction (main rule)
- Do NOT place plan references with JS-computed pixels. Reload the page and type plan values into the reference panel: polygon "ตำแหน่งมุม (ม.)" = `x,y; x,y; ...`; rectangle = "กลาง x/y" + length/depth/turn (README 25). Earlier B1-05 placement (pixel formula) is unscored/invalid.
- B1-05 redo: placement by typed plan values, then tie cam0 to the rug (4 corners, ~0.06 m last time). Blocker unchanged: cam1 has no matchable carpet corner (people hide them) -> expect data issue unless a clearer frame is found by pausing playback.
- Next scenarios to try: B3-20, B2-15. Ignore the JS formula in the Update section above.

## Data update from Finding Video
- B1-08 now Terrace 1 (4 cams crops, overlap 0.28), B2-11 = Lab 6p no-overlap crops (cam0 [0,0,260,210], cam1 [140,0,300,130]), B3-17 = Lab 4p no-overlap crops (cam2, cam3). All have 4+ plan refs per camera in floorplan.json. Not yet tried by this session; B1-04 and B1-07 unchanged.

## Session end summary (Testing, latest)
- Results: PASS B1-02, B1-03. FAIL B1-05 run1 (align 0.463), B3-16 run1 (align 0.178 OK; recall 0.77, ids 2.17), B3-20 run1 (recall 0.78 only; align 0.312, ids 1.50). B1-01 parked (6 runs). Data/precision issues: B1-04, B1-06, B1-09, B2-15.
- WORKING WORKFLOW (user-level, ~35 calls/scenario): reload page -> pick set (form_input on ref of 2nd combobox) -> plan rug already on page at plan position (centre 3.15/5.53, 2.24x3.75) else type plan values into the panel fields -> open cam full view -> select Reference B via ArrowDown x2 -> place corners with corner-bar buttons: button x positions shift after each placement; zoom region [0,40,400,70] at scale 0.6 after each one to read them (1 at ~186, 2 at ~233, 3 at ~275, 4 at ~297) -> hide minimap (623,25) BEFORE clicking points in the lower-left -> leave full view with click (100,300)+Escape x3 -> play (ref click), poll `playing` in JS 40 s at a time -> click every "ใช้ค่านี้" -> rewind -> play #2 -> ... -> `th.run('<scn>-runK')` (eval th from /devlog/th after each reload; run it un-awaited into window.__rdone then poll) -> `python tests/harness/score_dev.py <scn> <scn>-runK 0.35` -> usageLog dump via padded JSON (130 kB pad) + harness/extract.py -> finish_run.py (runlog.py start first) -> STATUS row -> <=5-line message.
- Untied cameras get tied from people (README 26) -> only ONE camera with a clean rug view is needed.
- Not yet run: swapped B1-08 (terrace crops), B2-11 and B3-17 (lab no-overlap crops), B1-10, B2-14, B2-12, B3-18, B3-19, B1-07, B2-13, then parked B1-01.
- B2-11, B3-17 tried: both data issues at t=0 (STATUS.md). Remaining: B1-08, B1-10, B2-14, B2-12, B3-18, B3-19, B1-07, B2-13, parked B1-01.
- 2026-11-14: B3-20 run 2 / B3-16 run 2 / B1-05 run 2 not completed: browser pane closed/reloaded mid-setup (screenshots timing out, page state reset). Resume with the polygon-rug workflow: rug on page is a 5-corner polygon (plan points + edge midpoint); cam0 corners 1=T,2=R,3=B,4=L; bar x: 1@186, then 2@235, 3@277, 4@297 (shift after each placement).

## Fresh Testing session (2026-11-14, Sonnet) summary
- B3-20 run2 FAIL (align 0.255 OK; recall 0.55, ids 1.83, count±1 29 %): cam0 rug tie 0.34 m (h 22.8), cam1+cam3 tied from people via offers, cam2 never tied. th.run + score_dev work (use `../NTT_Prototype/.venv-vision/Scripts/python.exe`, plain python has no numpy). Fixed align_score.per_cam_shape for untied cams.
- Data issues (no run): B1-08 (0.3 m identical tiles), B1-10, B2-14, B3-18 (pillar segments only).
- B2-12 plan: cam0 slabs R2,R3,R4 form one block: type 4 outer corners 0.399,18.582; 2.604,18.606; 2.619,20.281; 0.396,20.275 (a rectangle ref, "หรือตำแหน่งมุม"), then tie cam0 (corner order 1..4 clockwise on map), other cams via people. NOT done: browser pane hidden -> screenshots time out and map draw (tool "▭ สี่เหลี่ยม" -> drag -> "ตกลง" -> drag) did not register.
- Tricks: page keeps old Reference after set load; "ลบแผนที่ พื้นที่และการผูกกล้อง" clears (window.confirm override). Offers "ใช้ค่านี้" can be clicked in a JS poll loop (<40 s per call). Corner-bar buttons x: 185/223/262/297 after each placement; screenshot factor = 800/1024.
- (later) Pane is now a popout, 526x395 frame: emulate 1024x768 via resize_window, then page px x0.514 = frame px; helper `fc(el)` (centre in frame coords) and `cb()` (corner buttons) defined in page JS; confirm button "ตกลง" and the typed-corner field are scrolled out of view -> use JS click/focus then type. Corner buttons x (frame): 121,144,166,188 then shift. B3-20 run3 FAIL (see STATUS). B2-12 not tieable by eye (slab cells). B1-05 rebuilt: next step = identify rug corners with page zoom (+) and drag to pan.
- (latest) B3-20 run4 FAIL align 0.651 (STATUS). Pane = 526x395 css px (mobile layout): full camera view shows a 200x217 px image half-covered by the minimap; emulating 1024x768 gives screenshots cropped to the top-left 526x395 (no scaling any more). Corner ties are not usable until the popout pane is bigger (>= ~1000 px wide). Resume at B1-05 (rug typed polygon + cam0 4 corners), then B2-11, B2-15, B3-17, B1-07, B2-13, B1-08, B1-10, B2-14, B3-18, B3-20 run5, B3-16 run2, WILDTRACK.
- WORKING VIEW (2026-11-14 late): user widened the pane. Best precision view: resize_window 1024x1800 (tall emulation, scaled 0.46) -> full camera view fills the frame at ~430 px wide; page needs re-emulating after each pane width change. Frame = 468 px wide then; fc() = css*468/innerWidth. B1-05 run3: rug 4 corners T,R,B,L as 1,2,3,4 gave 0.13 m after nudging corner 4 (drag marker).

## Update 2026-11-15 (Testing T2, Sonnet) - read this, not the old sections
- Results: B3-20 run2/3/4 FAIL (best align 0.255 @run2; run4 0.651), B1-05 run3 align PASS 0.250 (count fixed by main: PASS), B2-15 run4 PASS align 0.115 + count (ids not scoreable), B3-17 run2/3 FAIL align 1.44, B2-11/B2-13/B1-08 data issues, B2-12 not tieable. See STATUS.md rows tagged (T2).
- Workflow that works (pane 800x707 css, user-resized; frame can differ - take a screenshot first): reload page, form_input ref_2 = set, eval th, JS-clear map (window.confirm=()=>true; click ลบแผนที่), real-click "วาด Reference" tool -> drag on map -> ตกลง (count) -> drag -> focus typed-corners input via JS (placeholder x,y or value with ';') -> type plan points -> Return. Full view: real click on the card's "⛶ เต็มจอ" (JS .click() does not open it); "-" zoom-out so the whole image fits; hide minimap with the "แผนที่เล็ก" button (JS click once). Select reference with form_input on that card's combobox ref (read_page interactive), not ArrowDown. Corner buttons x shift after each placement: read them with a JS helper (fc = centre in frame coords). Click Y may be offset from the screenshot Y by the sticky header: verify one click first.
- Rug numbering: a rectangle's rms hides a 180 deg flip (B2-15: wrong order -> 1.33 m). Check with per-cam align after the run.
- Offers "ใช้ค่านี้": JS poll loop (setInterval 2 s) click them; each th.run play of a 4-cam clip takes 4-5 min wall; poll with <=43 s sleeps.
- Remaining: B1-07, B3-20 re-run, B3-16 re-run, B1-09, B1-06, B1-01 (parked), B1-04/B2-12/B3-19 are on Testing-3 (port 8091).

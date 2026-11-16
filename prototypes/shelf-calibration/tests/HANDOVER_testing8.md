# Handover Testing T8 (2026-11-15), port 8091 -> next Testing session
Stopped by usage limit. Done (STATUS rows tagged T8): B3-18 run2 FAIL 0.379 m @0.35; B2-14 run2 p1 FAIL 0.825 m.
Left: score B2-14-T8-p2/p3 dumps if present (score_dev.py B2-14 B2-14-T8-p2 0.35); rerun B2-14 refusing cam1's large turn offer; then B1-10, B2-12, B3-19, B1-04.
## Tricks
- Campus cam0 is rolled ~1.2°: UNTICK "กล้องไม่เอียงข้าง" (.level) on cam0. Ticked = free-fit fallback or 0.3-0.5 m card; unticked = real camera 0.06-0.10 m, 0.056 m vs truth (B3-18).
- cam0 pixels (people-free median background of 10 frames): B3-18 (560x460) plan order R1a,R1b,R2a,R2b,R3a,R3b,bag,binL,binR = (25,285),(105,283),(243,258),(403,257),(469,279),(545,277),(77,304),(38,283),(493,276). B2-14 (580x380) = same minus 41 px in x (no pillar L / bin L).
- Hidden pane: setTimeout takes up to 11 s and requestAnimationFrame never fires. Replace ui.js slp with a fetch loop (try/catch each fetch) before eval; poll in calls <= 38 s; run long work un-awaited and store results on window.
- References: 2-point refs are refused (3-12): add a third plan point and leave it unclicked. Further refs need clicks on EMPTY map (elementFromPoint tag svg), then typePts. Never typePts while another ref is selected (it overwrites that ref; fewer corners than ties crashes draw()).
- Per-point card errors: text "Reference A มุม k 0.xx ม." in .camOut; delete buttons button[data-act=del].
- Offers: log the 170 chars before "ใช้ค่านี้". Refuse: anything on click-tied cam0 (it gets -16..-46° turn offers), people refits whose text says own clicks > 2 m off (cam1 drifted to 1.35 m shape). cam2 turn 20° in B3-18 helped (0.86 -> 0.379); cam1 turn -53° in B2-14 hurt (2.07 m).
## Update 2 (after the page fixes: roll pose automatic, refit height cap, align vs click-tied only)
Done: B2-14 run3 PASS 0.142 m; B1-10 run2 FAIL 0.587 m (cam0+cam2 alone 0.269 m). Left: B1-10 retry (cam1 WITHOUT my guessed anchors: cancel its tie, delete its 2 points, replay 2x), then B2-12, B3-19, B1-04.
- Leave "กล้องไม่เอียงข้าง" ticked now. B2-14 cam0 px and B1-10 cam0/cam2 px are in their STATUS rows (T8).
- A camera click-tied from 3 weak points gets NO people offers. Give weak cameras only 2 anchor clicks (4/6 values) so they stay untied; then offers come. Need a 3-pt reference with one corner left unclicked.
- Campus people ties: refuse h > ~1.5x the click-tied camera (cam0 1.8-1.9 m). Good ones were h 2.05 (B2-14 cam1). An early 40-pt tie (card 0.03 m, h 3.11) was 2.1 m off.
- Loader used this session (page reload each scenario): eval th; fetch ui src; replace its slp with a fetch loop with try/catch; define acc5/chain5 (see STATUS notes: allow list, own-clicks > 2 m skip, height undo via 'ยกเลิกการปรับ'); run un-awaited, poll <= 38 s per call. A 30 s clip takes 60-110 s per play.

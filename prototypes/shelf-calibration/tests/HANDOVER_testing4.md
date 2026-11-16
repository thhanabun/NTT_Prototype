# Handover: Testing System 4 (T4), port 8091
Done (STATUS.md rows tagged (T4)): B1-10 run1 FAIL (align 10.6 m, 5 plan pts), B2-14 run1 FAIL (5.6 m), B3-18 run1 FAIL (0.38 m, cam0 only). Left (main's order): rerun B1-10 (plan now 7 cam0 pts + bins; best camera first), rerun B2-14 (cam1 first: pillar A/B 4 pts → 0.07 m exact), then B2-12, B3-19, B1-04 (rebuilt, ready).
## Workflow that worked (1024x1800 emulation; frame 800 wide, css*0.78125; the emulation resets sometimes: re-run resize_window and take a screenshot before coordinate clicks)
- navigate, eval /devlog/th, `window.confirm=()=>true`, set #vset + change, click button title^="ลบแผนที่".
- Reference: click "วาด Reference" button (JS), set #askN, click #askOk. 1st ref: click N map points (map ≈ x410-780,y250-850 frame). Further refs: DRAG a box on the map instead (status says ลากกรอบ), then type metres into #sPts (click field, ctrl+a, type "x,y; x,y; ...", Enter). Vertex order = click order on cameras.
- Camera: JS click button[title^="กล้องนี้เต็มจอ"][i], #rewind, click "แผนที่เล็ก" (625,25) once, screenshot + zoom (offset = region origin), arm "k +" buttons at y=55, x=186,222,254,287,320,354,389,424,457; exit full view with click (566,25). Click points batch in one browser_batch.
- Camera height field "สูงจากพื้น" (placeholder ?) can be typed (cam0 campus ≈ 2.0 m).
- th.run un-awaited into window.__rdone; poll in calls of ≤30 s (pane hidden → 45 s timeout). Accept offers: find "ใช้ค่านี้" by JS, scrollIntoView, click at frame coords (rect*0.78125+8); refs from `find` click wrong coords.
- Score: ../NTT_Prototype/.venv-vision/Scripts/python.exe tests/harness/score_dev.py <scn> <run> 0.35
## Findings
- Campus cam0 clicks: pillar bases are occluded by people at t=0; card rms 0.29 (B1-10, 5 pts), 0.42 (B2-14, 6 pts), 0.65 (B3-18, 9 pts); worst = occluded pillar-R right end.
- Main: scale is fine (dev check 0.93–1.04); my 0.39 scorer scale came from bad ties. People ties from cam0 with h<1.8 are refused; cam1/cam2 heights 0.4–0.9 m were implausible (before that fix).
- Campus cam1 (2 pts) and cam2 (pillar A/B strip, near-collinear, ambiguous pillar identity) are the weak cameras; after reload the page keeps refs but not video.
## Main's tip for the B3-18 rerun (received after the handover)
cam0: remove points whose own card error is > 0.4 m (pt 9 first) until the card is <= 0.3 m, keep >= 6 spread points. Don't click cam2's ambiguous pillars. Play, accept cam1's offer (main saw it to 0.13 m, 133 pairs with exact points), play again for cam2.
## Data update from Finding Video 2 (after the handover)
B3-18 cam2 rebuilt: taller crop (feet visible), plan anchors relabelled (middle pillar base, dark bin foot, big right pillar with yellow sign; pillar B dropped), only ~0.8 m depth spread → tie cam2 from overlap/people with cam0. visible_count_per_s recomputed (B3-18 count rows above are stale). Re-read tests/videos/B3-18/floorplan.json before the rerun.

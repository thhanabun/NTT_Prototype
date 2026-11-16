# Handover: Testing System 3 (T3), port 8091
Done (rows in STATUS.md tagged (T3)): B2-12 run1 FAIL, B3-19 run1+run2 FAIL, B1-04 DATA ISSUE, B1-10 run1 FAIL (align 7.9 m, scorer scale issue?). Left: B2-14, B3-18.
## Workflow that works (1024x1800 emulation; frame = 800 wide, css*0.78125)
- Reload, eval /devlog/th, define helpers (st, arm(k), cb(), poll(sec), rz(), wz()). Set select #vset value to scenario id, dispatch change.
- Pane hidden => JS calls time out at 45 s: use poll(35-42) per call. th.run un-awaited into window.__rdone then poll.
- Reference: map tool "วาด Reference", askN, click/drag on map, then type corners in #sPts (polygon) / sPts for rect ("หรือตำแหน่งมุม"), Enter. Page keeps refs after reload; "ลบแผนที่…" clears (window.confirm=()=>true).
- Camera: set Reference select, open full view (button title "กล้องนี้เต็มจอ"), hide mini map by clicking the แผนที่เล็ก button ONCE (screenshots lag ~1-2 s, check before 2nd click). Arm a corner with arm(k) (JS click on "k +" button), then computer click at frame coords: x=12.5+k*vx, y=108.4+k*vy where k=0.78125*992/videoWidth (canvas rect from JS).
- Wheel zoom: dispatch WheelEvent on the big canvas anchored at clientX/Y (14 ticks ~ 600 %); rz() resets.
- Point identification trick: brute-force homography over candidate assignments (cv2.findHomography), take the one with ~2 px rms; SIFT-align one scenario's frame onto another (B3-19 cam0 -> B1-04 cam0) to transfer pixels.
- Score: ../NTT_Prototype/.venv-vision/Scripts/python.exe tests/harness/score_dev.py <scn> <run> 0.30
## Findings
- WILDTRACK plan points are clickable (grates+manhole cam1/cam2: tie 0.05 m, h 2.7 m) but people-tie offers never appear for other cams (B2-12, B3-19).
- B1-04 cam0: 4 anchors in a narrow image band -> page cannot tie.
- B1-10: cam0 rect/poly of 4 pillar/door base points tied 0.22 m; cams 1,2 got offers; scorer align 7.9 m (frame/scale).

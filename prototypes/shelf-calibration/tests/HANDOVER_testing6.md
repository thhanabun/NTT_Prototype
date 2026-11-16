# Handover Testing T6 (2026-11-15) -> next Testing session
## Done (STATUS rows tagged T6)
- B3-20 run6 FAIL 0.431 m (was 0.79). No mirror: scorer flip=1 is the NORMAL value (all passing runs show 1; -1 = mirror). Old 0.73 m came from cam0 rug corner 4 hidden by a leg at t=0. Cams 1-3 people ties stay ~0.5 m off.
- B3-16 run2 FAIL ids 2.17 (align 0.186 OK). Low-res id limit.
- B1-09 run2 FAIL ids 3.67 / count 43 % (align 0.269 OK). A people tie with card 0.17 m was 3.3 m off (reported to main).
## Next (queue): B1-06, B2-13, B1-08 (terrace x2.12; B1-08 tie cam3 first), B3-18, B2-14 (cam1 first), B1-10, B2-12, B3-19, B1-04, B1-01, then B3-17.
## Tricks (they work with the pane HIDDEN or minimized; screenshots fail then)
- Helpers: see the JS in this session: arm(k) clicks the corner button k in full view; sclick(px,py,W,H) sends pointer/mouse events on the video canvas WxH at video px; sdrag/sclk work on the map svg; typePts('x,y; ...') fills #sPts + Enter; newRef(n); setRef(camIdx,'rNN'); autoAcc(sec) waits <=sec and accepts people offers (<=0.30 m or >=30 pts); keep it <=38 s per call (45 s tool limit).
- To see a frame: draw the video to a canvas, POST dataURLs to /devlog/<name>, decode with python + cv2 into the scratchpad, Read the png (add a 20/30 px tick grid).
- Hide the minimap ('แผนที่เล็ก') in full view before clicking near the bottom-left (clicks land on its svg).
- A point that is already set moves only by drag, not by a new click (arm + click on '✓' only selects it). The undo button: title 'Ctrl+Z'. 'ยกเลิกการปรับ' removes a camera's people tie.
- Diagnosis only (never to place points): project plan points with inv(truth H_img_to_floor_m); compare page fits (dump 'fits'[i].H, metres) to truth on a pixel grid = raw per-camera error.

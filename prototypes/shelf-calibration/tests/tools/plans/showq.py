import sys, json, cv2, numpy as np
Q = json.load(open("tools/plans/quads_all.json"))
for key, img, z in (("terrace1:1", "tools/scratch/bg_terrace1_1.png", 2.6), ("wt:5", "tools/scratch/bg_wt_5.png", 1.0)):
    im = cv2.resize(cv2.imread(img), None, fx=z, fy=z)
    for q in Q[key]["quad_px"]:
        cv2.polylines(im, [np.int32(np.array(q) * z)], True, (0, 0, 255), 2)
    for p in Q[key]["px"]: cv2.circle(im, (int(p[0] * z), int(p[1] * z)), 3, (0, 255, 0), -1)
    cv2.imwrite(f"tools/scratch/sq_{key.replace(':','_')}.png", im)

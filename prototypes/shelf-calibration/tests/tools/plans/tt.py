import sys; sys.path.insert(0, 'C:/Users/User/OneDrive/Desktop/nttdata_cam/shelf-calibration-prototype/tests/tools/plans')
from tiles import *
for ds in ("terrace1", "campus4"):
    for c in range(3):
        ci = cam_info(ds, c); bg = background(ci["video"]); cv2.imwrite(f"tools/scratch/bg_{ds}_{c}.png", bg)
        L = lattice(bg, ci["H"], ci["unit_m"], 150 if ds == "terrace1" else 140)
        print(ds, c, None if L is None else [(round(f["theta"]), round(f["period_m"], 2), round(f["strength"], 1)) for f in L["fams"]])

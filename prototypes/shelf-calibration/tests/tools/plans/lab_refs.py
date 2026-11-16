"""carpet outline (blue floor pixels of all 4 cameras voted on the floor) and rug quad for lab4p / lab6p, in floor metres"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from calib import *
OUT = Path(__file__).parent
RUG_CLICKS_C0 = [[130, 90], [186, 114], [41, 176], [6, 131]]   # rug corners as seen in camera 0 (360x288) - same view in 4p and 6p
def run(ds, frame=0):
    cis = [cam_info(ds, c) for c in range(4)]; u = cis[0]["unit_m"]
    pts = np.vstack([apply_H(ci["H"], [[360 / 2, 288 / 2]]) for ci in cis]); ctr = pts.mean(0)
    cell = 2.0; gs = 360; G0 = ctr - gs * cell / 2
    gx, gy = np.meshgrid(np.arange(gs), np.arange(gs)); cells = np.c_[gx.ravel() * cell + G0[0], gy.ravel() * cell + G0[1]].astype(np.float32)
    votes = np.zeros(gs * gs); seen = np.zeros(gs * gs)
    for c, ci in enumerate(cis):
        cap = cv2.VideoCapture(str(ci["video"])); cap.set(1, frame); ok, img = cap.read()
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); blue = ((hsv[..., 0] > 95) & (hsv[..., 0] < 130) & (hsv[..., 1] > 60) & (hsv[..., 2] > 50)).astype(np.uint8)
        Hi = np.linalg.inv(ci["H"]); h = Hi @ np.c_[cells, np.ones(len(cells))].T; w = h[2]; px = (h[:2] / np.where(w == 0, 1e-9, w)).T
        cen = apply_H(ci["H"], [[180, 200]])[0]; s = np.sign((Hi @ [cen[0], cen[1], 1])[2])
        ok_ = (np.sign(w) == s) & (px[:, 0] >= 0) & (px[:, 0] < 359) & (px[:, 1] >= 0) & (px[:, 1] < 287)
        v = np.zeros(len(cells)); v[ok_] = blue[px[ok_, 1].astype(int), px[ok_, 0].astype(int)]; votes += v; seen += ok_
    mask = ((seen > 0) & (votes / np.maximum(seen, 1) > 0.5)).reshape(gs, gs).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask); big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); m = (lab == big).astype(np.uint8)
    cnt = max(cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0], key=cv2.contourArea)
    poly = cv2.approxPolyDP(cnt, 3.0, True).reshape(-1, 2) * cell + G0
    rug = apply_H(cis[0]["H"], RUG_CLICKS_C0)
    return {"unit_m": u, "carpet": (poly * u).tolist(), "rug": (rug * u).tolist(), "carpet_area_m2": float(cv2.contourArea((poly * u).astype(np.float32)))}
if __name__ == "__main__":
    res = {ds: run(ds) for ds in ("lab4p", "lab6p")}
    json.dump(res, open(OUT / "lab_refs.json", "w"), indent=1)
    for ds, r in res.items(): print(ds, "carpet pts", len(r["carpet"]), "area", round(r["carpet_area_m2"], 1), "rug", np.round(r["rug"], 2).tolist())

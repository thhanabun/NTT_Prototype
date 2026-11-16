import sys, cv2, numpy as np
# usage: sheet.py out.png frame video1 video2 ...
out, fr, vids = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = []
for v in vids:
    c = cv2.VideoCapture(v); c.set(cv2.CAP_PROP_POS_FRAMES, fr); ok, f = c.read()
    print(v, c.get(cv2.CAP_PROP_FRAME_COUNT), c.get(cv2.CAP_PROP_FPS), f.shape if ok else None)
    if ok: ims.append(cv2.resize(f, (480, int(480 * f.shape[0] / f.shape[1]))))
h = max(i.shape[0] for i in ims); ims = [cv2.copyMakeBorder(i, 0, h - i.shape[0], 0, 0, cv2.BORDER_CONSTANT) for i in ims]
n = 2; rows = [np.hstack(ims[k:k + n]) for k in range(0, len(ims), n)]
w = max(r.shape[1] for r in rows); rows = [cv2.copyMakeBorder(r, 0, 0, 0, w - r.shape[1], cv2.BORDER_CONSTANT) for r in rows]
cv2.imwrite(out, np.vstack(rows))

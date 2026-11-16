import sys, cv2, numpy as np
# grid.py out.png video frame zoom [tick]
out, vid, fr, z = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4]); tick = int(sys.argv[5]) if len(sys.argv) > 5 else 20
if vid.endswith((".png", ".jpg")): im = cv2.imread(vid)
else:
    c = cv2.VideoCapture(vid); c.set(1, fr); ok, im = c.read()
im = cv2.resize(im, None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC); h, w = im.shape[:2]
for x in range(0, int(w / z), tick):
    cv2.line(im, (int(x * z), 0), (int(x * z), h), (0, 255, 255) if x % (tick * 5) == 0 else (120, 120, 0), 1)
    if x % (tick * 2) == 0: cv2.putText(im, str(x), (int(x * z) + 2, 12), 0, .4, (0, 0, 255), 1)
for y in range(0, int(h / z), tick):
    cv2.line(im, (0, int(y * z)), (w, int(y * z)), (0, 255, 255) if y % (tick * 5) == 0 else (120, 120, 0), 1)
    if y % (tick * 2) == 0: cv2.putText(im, str(y), (2, int(y * z) - 2), 0, .4, (0, 0, 255), 1)
cv2.imwrite(out, im)

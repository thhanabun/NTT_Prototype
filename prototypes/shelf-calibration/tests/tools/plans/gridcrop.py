import sys, cv2, numpy as np
# gridcrop.py out.png img x0 y0 x1 y1 zoom tick  -> faint dotted ticks, labels on every line
out, img = sys.argv[1], cv2.imread(sys.argv[2]); x0, y0, x1, y1 = map(int, sys.argv[3:7]); z = float(sys.argv[7]); tick = int(sys.argv[8])
im = cv2.resize(img[y0:y1, x0:x1], None, fx=z, fy=z, interpolation=cv2.INTER_CUBIC); ov = im.copy()
for x in range((x0 // tick + 1) * tick, x1, tick):
    X = int((x - x0) * z)
    for Y in range(0, im.shape[0], 8): cv2.circle(ov, (X, Y), 1, (0, 255, 255), -1)
    cv2.putText(ov, str(x), (X - 10, 10), 0, .35, (0, 0, 255), 1)
for y in range((y0 // tick + 1) * tick, y1, tick):
    Y = int((y - y0) * z)
    for X in range(0, im.shape[1], 8): cv2.circle(ov, (X, Y), 1, (0, 255, 255), -1)
    cv2.putText(ov, str(y), (2, Y + 4), 0, .35, (0, 0, 255), 1)
cv2.imwrite(out, ov)

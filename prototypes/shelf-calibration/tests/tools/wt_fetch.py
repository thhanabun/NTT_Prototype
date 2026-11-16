"""Fetch only a subset of WILDTRACK (EPFL CVLab, research use) from the 6.8 GB zip using HTTP range requests."""
import io, os, sys, zipfile, urllib.request, json
URL = "https://documents.epfl.ch/groups/c/cv/cvlab-unit/www/data/Wildtrack/Wildtrack_dataset_full.zip"
class R(io.RawIOBase):
    def __init__(s):
        r = urllib.request.Request(URL, headers={"Range": "bytes=0-0"})
        s.size = int(urllib.request.urlopen(r, timeout=60).headers["Content-Range"].split("/")[1]); s.pos = 0
    def seekable(s): return True
    def readable(s): return True
    def tell(s): return s.pos
    def seek(s, o, w=0):
        s.pos = o if w == 0 else s.pos + o if w == 1 else s.size + o; return s.pos
    def readinto(s, b):
        n = len(b)
        if n == 0 or s.pos >= s.size: return 0
        end = min(s.size - 1, s.pos + n - 1)
        for _ in range(5):
            try:
                d = urllib.request.urlopen(urllib.request.Request(URL, headers={"Range": f"bytes={s.pos}-{end}"}), timeout=120).read(); break
            except Exception as e: err = e
        else: raise err
        b[:len(d)] = d; s.pos += len(d); return len(d)
if __name__ == "__main__":
    z = zipfile.ZipFile(io.BufferedReader(R(), 1 << 16))
    names = z.namelist(); pass
    if sys.argv[1] == "list":
        import collections
        c = collections.Counter("/".join(n.split("/")[:3]) for n in names); [print(k, v) for k, v in sorted(c.items())][:0]
        for n in names[:5]: print(n)
    else:
        out, pats, step, lim = sys.argv[1], sys.argv[2].split(","), int(sys.argv[3]), int(sys.argv[4])
        sel = [n for n in names if any(p in n for p in pats) and not n.startswith("__MACOSX")]
        sel.sort(key=lambda n: (1, n.rsplit("/",1)[1], n) if "Image_subsets" in n else (0, n)); print(len(sel), flush=True)
        for n in sel:
            if n.endswith("/"): continue
            if "Image_subsets" in n:
                idx = int(n.rsplit("/", 1)[1].split(".")[0])
                if idx // 5 % step or idx // 5 >= lim * 1: continue
            import os
            if os.path.exists(os.path.join(out, n)): continue
            if os.path.exists(os.path.join(out, n)): continue
            try:
                i = z.getinfo(n); raw = z.fp.raw if hasattr(z.fp, "raw") else z.fp
                z.fp.seek(i.header_offset); 
                if z.fp.read(4) != b"PK": i.header_offset -= 1 << 32
                import struct, zlib
                fp = z.fp; fp.seek(i.header_offset); h = fp.read(30); nl, el = struct.unpack("<HH", h[26:30]); fp.seek(i.header_offset + 30 + nl + el)
                raw = fp.read(i.compress_size); data = raw if i.compress_type == 0 else zlib.decompress(raw, -15)
                dst = os.path.join(out, n); os.makedirs(os.path.dirname(dst), exist_ok=True); open(dst, "wb").write(data)
            except Exception as e: print("FAIL", n, e)

import os, struct, zlib

out = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(out, exist_ok=True)

def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xffffffff
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

def png(w, h, pixel):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixel(x, y, w, h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")

def px(x, y, w, h):
    nx = (x + 0.5) / w
    ny = (y + 0.5) / h
    r = 0.18
    sx = min(nx, 1 - nx)
    sy = min(ny, 1 - ny)
    if sx < r / 2 and sy < r / 2:
        cx = cy = r / 2
        dx, dy = sx - cx, sy - cy
        if dx * dx + dy * dy > (r / 2) * (r / 2):
            return (0, 0, 0, 0)
    px_ = (nx - 0.42) / 0.28
    py_ = (ny - 0.52) / 0.22
    if px_ * px_ + py_ * py_ <= 1:
        blobs = [
            (0.28, 0.50, 0.08, (46, 74, 155)),
            (0.40, 0.40, 0.08, (200, 136, 10)),
            (0.52, 0.47, 0.08, (196, 30, 58)),
            (0.44, 0.60, 0.08, (11, 110, 79)),
            (0.31, 0.62, 0.07, (92, 64, 51)),
        ]
        for bx, by, br, col in blobs:
            ddx, ddy = nx - bx, ny - by
            if ddx * ddx + ddy * ddy <= br * br:
                return col + (255,)
        return (230, 215, 195, 255)
    if 0.58 < nx < 0.70 and 0.14 < ny < 0.48:
        t = (ny - 0.14) / 0.34
        return (212, 85, 43, 255) if t > 0.2 else (196, 163, 90, 255)
    return (26, 22, 18, 255)

for size in (192, 512):
    path = os.path.join(out, "icon-%s.png" % size)
    with open(path, "wb") as f:
        f.write(png(size, size, px))
    print("wrote", path)

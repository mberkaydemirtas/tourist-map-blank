# OR-tool/matrix.py
import os, math, time, hashlib
import googlemaps
from typing import List, Tuple

API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
TTL = int(os.getenv("MATRIX_CACHE_TTL_SECONDS", "21600"))
USE_HAVERSINE_ONLY = os.getenv("USE_HAVERSINE_ONLY","").lower() in ("1","true","yes","on")

# Basit in-memory cache
_matrix_cache = {}

def _hash_points(points, mode):
    h = hashlib.md5()
    h.update(mode.encode())
    for p in points:
        h.update(f"{float(p.lat):.6f},{float(p.lon):.6f}|".encode())
    return h.hexdigest()

def haversine_m(a, b):
    if a is b: return 0
    R = 6371000.0
    dlat = math.radians(float(b.lat) - float(a.lat))
    dlon = math.radians(float(b.lon) - float(a.lon))
    s1 = math.radians(float(a.lat)); s2 = math.radians(float(b.lat))
    h = math.sin(dlat/2)**2 + math.cos(s1)*math.cos(s2)*math.sin(dlon/2)**2
    return int(2 * R * math.asin(math.sqrt(h)))

def _speed_mpm(mode: str) -> int:
    # basit şehir içi kabuller (m/dk)
    return {
        "walking":   80,   # ~4.8 km/h
        "bicycling": 250,  # ~15 km/h
        "driving":   800,  # ~48 km/h
        "transit":   500,  # yaklaşık
    }.get(mode, 800)

def build_haversine_matrix(points, mode="driving"):
    n = len(points)
    meters = [[0]*n for _ in range(n)]
    mins   = [[0]*n for _ in range(n)]
    speed = _speed_mpm(mode)
    for i in range(n):
        for j in range(n):
            m = haversine_m(points[i], points[j])
            meters[i][j] = int(m)
            mins[i][j]   = int(math.ceil(m / max(1, speed)))
    return mins, meters

def build_time_distance_matrix(points, mode="driving") -> Tuple[List[List[int]], List[List[int]]]:
    """
    Google Distance Matrix ile dakika ve metre matrisi döndürür.
    Ancak USE_HAVERSINE_ONLY=1 ise doğrudan haversine kullanır.
    """
    if USE_HAVERSINE_ONLY:
        return build_haversine_matrix(points, mode)

    if not API_KEY:
        raise RuntimeError("GOOGLE_MAPS_API_KEY missing")

    key = _hash_points(points, mode)
    now = time.time()
    cached = _matrix_cache.get(key)
    if cached and now - cached["t"] < TTL:
        return cached["mins"], cached["meters"]

    gmaps = googlemaps.Client(key=API_KEY)

    origins = [(p.lat, p.lon) for p in points]
    destinations = origins

    resp = gmaps.distance_matrix(
        origins=origins,
        destinations=destinations,
        mode=mode,
        units="metric",
        departure_time="now"
    )
    rows = resp["rows"]
    n = len(points)
    mins = [[0]*n for _ in range(n)]
    meters = [[0]*n for _ in range(n)]
    for i in range(n):
        els = rows[i]["elements"]
        for j in range(n):
            e = els[j]
            if e.get("status") != "OK":
                hm = haversine_m(points[i], points[j])
                meters[i][j] = int(hm)
                mins[i][j] = max(1, math.ceil(hm / 80.0))
            else:
                meters[i][j] = e["distance"]["value"]
                mins[i][j] = max(1, math.ceil(e["duration"]["value"] / 60.0))

    _matrix_cache[key] = {"t": now, "mins": mins, "meters": meters}
    return mins, meters
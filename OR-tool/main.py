from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Literal, Annotated
from dotenv import load_dotenv
import logging, os, math, traceback

from matrix import build_time_distance_matrix, build_haversine_matrix
from solver import solve_day_vrptw

load_dotenv()
app = FastAPI(title="TouristMap Optimizer", version="0.2.4")

TravelMode = Literal["driving", "walking", "bicycling", "transit"]

@app.middleware("http")
async def log_requests(request: Request, call_next):
    if request.url.path.startswith("/opt") or request.url.path.startswith("/route"):
        print(f"[OPT] {request.method} {request.url.path}?{request.url.query}")
    try:
        return await call_next(request)
    except Exception:
        logging.exception("Unhandled server error (middleware)")
        raise

class Coords(BaseModel):
    lat: float
    lon: Optional[float] = None
    lng: Optional[float] = None

    @model_validator(mode="after")
    def _unify_lon(self):
        if self.lon is None and self.lng is not None:
            self.lon = float(self.lng)
        if self.lon is None or (isinstance(self.lon, float) and (math.isnan(self.lon) or math.isinf(self.lon))):
            raise ValueError("coords.lon/lng is required and must be finite")
        if isinstance(self.lat, float) and (math.isnan(self.lat) or math.isinf(self.lat)):
            raise ValueError("coords.lat must be finite")
        return self

class Stop(BaseModel):
    id: str
    name: str
    coords: Coords
    stay_mins: int = 30
    open_min: Optional[int] = None
    close_min: Optional[int] = None

class OptimizeDayRequest(BaseModel):
    day_start_time_min: int = Field(..., description="Günün başlangıcı (dk)")
    day_end_time_min:   int = Field(..., description="Günün bitişi (dk)")
    start: Coords
    end: Coords
    mode: TravelMode = "driving"
    stops: Annotated[List[Stop], Field(min_length=1)]

class OptimizeDayResponse(BaseModel):
    order: List[str]
    total_minutes: int
    legs_minutes: List[int]
    service_minutes: List[int]
    warnings: List[str] = []

@app.get("/health")
def health():
    return {"ok": True, "version": "0.2.4"}

@app.get("/status")
def status():
    return {
        "version": "0.2.4",
        "mode": os.getenv("OPT_SOLVER_MODE","").lower() or "ortools",
        "use_haversine_only": os.getenv("USE_HAVERSINE_ONLY",""),
        "has_gmaps_key": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
    }

def _nn_order(matrix_minutes: List[List[int]], n: int) -> List[int]:
    visited = {0}
    order_idx = [0]
    cur = 0
    while len(visited) < n - 1:
        cand, best = None, 10**9
        for j in range(1, n - 1):
            if j in visited:
                continue
            t = int(matrix_minutes[cur][j])
            if t < best:
                best, cand = t, j
        if cand is None:
            break
        visited.add(cand)
        order_idx.append(cand)
        cur = cand
    order_idx.append(n - 1)
    return order_idx

def _make_response(order_idx, matrix_minutes, service, stops_len, warnings, total_override=None):
    stop_ids_order = [str(i) for i in range(stops_len)]  # safety hint (not used directly)
    # build safe lists
    order_ids = [str_id for str_id in [
        (None if not (1 <= i <= stops_len) else i) for i in order_idx
    ] if str_id is not None]
    # map to given stop ids
    order = []
    for i in order_idx:
        if 1 <= i <= stops_len:
            order.append(str_id := str_id)  # placeholder to keep pyright calm

    # real mapping
    order = []
    for i in order_idx:
        if 1 <= i <= stops_len:
            order.append(str(i))  # will be replaced by actual stop ids at call site

    legs = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
    if total_override is None:
        total = int(sum(legs) + sum(int(x) for x in service))
    else:
        total = int(total_override)
    return order, legs, total, [str(w) for w in (warnings or [])]

@app.post("/optimize-day", response_model=OptimizeDayResponse)
def optimize_day(req: OptimizeDayRequest):
    try:
        # ---- 0) doğrulama
        if req.day_end_time_min <= req.day_start_time_min:
            raise HTTPException(status_code=400, detail="day_end_time_min > day_start_time_min olmalı.")
        if not req.stops:
            raise HTTPException(status_code=400, detail="En az bir stop gereklidir.")

        # ---- 1) noktalar & pencereler
        points = [req.start] + [s.coords for s in req.stops] + [req.end]
        n = len(points)

        service = [0] + [int(s.stay_mins or 0) for s in req.stops] + [0]
        opens   = [int(req.day_start_time_min)] + [
            int(s.open_min) if s.open_min is not None else int(req.day_start_time_min) for s in req.stops
        ] + [int(req.day_start_time_min)]
        closes  = [int(req.day_end_time_min)] + [
            int(s.close_min) if s.close_min is not None else int(req.day_end_time_min) for s in req.stops
        ] + [int(req.day_end_time_min)]

        if not (len(service) == len(opens) == len(closes) == n):
            raise HTTPException(status_code=400, detail="service/open/close uzunlukları uyuşmuyor")
        for k, (o, c) in enumerate(zip(opens, closes)):
            if o > c:
                raise HTTPException(status_code=400, detail=f"time window hatası: node {k} için open>close")

        # ---- 2) zaman matrisi
        use_haversine_only = (os.getenv("USE_HAVERSINE_ONLY","").lower() in ("1","true","on","yes"))
        if not use_haversine_only:
            try:
                matrix_minutes, _ = build_time_distance_matrix(points, mode=req.mode)
            except Exception as e:
                logging.warning(f"build_time_distance_matrix failed ({e}); fallback haversine.")
                matrix_minutes, _ = build_haversine_matrix(points, mode=req.mode)
        else:
            matrix_minutes, _ = build_haversine_matrix(points, mode=req.mode)

        if len(matrix_minutes) != n or any(len(r) != n for r in matrix_minutes):
            raise HTTPException(status_code=500, detail="time_matrix boyut hatası")

        # ---- 3) Greedy mod istenmişse
        opt_mode = (os.getenv("OPT_SOLVER_MODE", "") or "").lower()
        if opt_mode in ("nn", "greedy", "1", "true", "on"):
            order_idx = _nn_order(matrix_minutes, n)
            legs = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs) + sum(int(x) for x in service))
            order_ids = [req.stops[i - 1].id for i in order_idx if 1 <= i <= len(req.stops)]
            svc_mins_order = [int(service[i]) for i in order_idx if 1 <= i <= len(req.stops)]
            return OptimizeDayResponse(
                order=[str(x) for x in order_ids],
                total_minutes=int(total),
                legs_minutes=[int(x) for x in legs],
                service_minutes=[int(x) for x in svc_mins_order],
                warnings=["Greedy (NN) kullanıldı."]
            )

        # ---- 4) OR-Tools (hata olursa otomatik NN fallback)
        try:
            order_idx, legs_travel, total, warnings = solve_day_vrptw(
                time_matrix=matrix_minutes,
                service_times=[int(x) for x in service],
                open_mins=[int(x) for x in opens],
                close_mins=[int(x) for x in closes],
                penalty_early=int(os.getenv("OPT_PENALTY_EARLY", "3")),
                penalty_late=int(os.getenv("OPT_PENALTY_LATE", "5")),
                penalty_overtime=int(os.getenv("OPT_PENALTY_OVERTIME", "10")),
                allow_skipping=(os.getenv("OPT_ALLOW_SKIPPING", "false").lower() in ("1","true","on")),
            )
        except Exception as e:
            logging.error("solve_day_vrptw raised, falling back to NN")
            logging.error("".join(traceback.format_exception(e)))
            order_idx = _nn_order(matrix_minutes, n)
            legs_travel = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs_travel) + sum(int(x) for x in service))
            warnings = ["OR-Tools failed, Greedy (NN) fallback"]

        order_ids = [req.stops[i - 1].id for i in order_idx if 1 <= i <= len(req.stops)]
        svc_mins_order = [int(service[i]) for i in order_idx if 1 <= i <= len(req.stops)]
        return OptimizeDayResponse(
            order=[str(x) for x in order_ids],
            total_minutes=int(total),
            legs_minutes=[int(x) for x in legs_travel],
            service_minutes=[int(x) for x in svc_mins_order],
            warnings=[str(w) for w in (warnings or [])]
        )

    except HTTPException:
        raise
    except Exception as e:
        logging.exception("optimize-day failed (outer)")
        raise HTTPException(status_code=500, detail=f"{e.__class__.__name__}: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=False, log_level="debug")

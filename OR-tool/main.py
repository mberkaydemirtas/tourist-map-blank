from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Annotated
from dotenv import load_dotenv
import logging, os, traceback

from matrix import build_time_distance_matrix, build_haversine_matrix
from solver import solve_day_vrptw

load_dotenv()
app = FastAPI(title="TouristMap Optimizer", version="0.2.0")

TravelMode = Literal["driving", "walking", "bicycling", "transit"]

class Coords(BaseModel):
    lat: float
    lon: float

class Stop(BaseModel):
    id: str
    name: str
    coords: Coords
    stay_mins: int = 30
    open_min: Optional[int] = None   # dakikalar
    close_min: Optional[int] = None

class OptimizeDayRequest(BaseModel):
    day_start_time_min: int = Field(..., description="Günün başlangıcı (dakika). Örn: 9*60")
    day_end_time_min:   int = Field(..., description="Günün bitişi (dakika). Örn: 20*60")
    start: Coords
    end: Coords
    mode: TravelMode = "driving"
    stops: Annotated[List[Stop], Field(min_length=1)]

class OptimizeDayResponse(BaseModel):
    order: List[str]           # stop id sırası
    total_minutes: int         # travel + service
    legs_minutes: List[int]    # her leg travel dk
    service_minutes: List[int] # sıralı durak servis dk
    warnings: List[str] = []

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/status")
def status():
    return {
        "mode": os.getenv("OPT_SOLVER_MODE","").lower() or "ortools",
        "use_haversine_only": os.getenv("USE_HAVERSINE_ONLY",""),
        "has_gmaps_key": bool(os.getenv("GOOGLE_MAPS_API_KEY")),
    }

# OR-tool/main.py  (optimize_day fonksiyonunun tamamını değiştir)
@app.post("/optimize-day", response_model=OptimizeDayResponse)
def optimize_day(req: OptimizeDayRequest):
    try:
        if req.day_end_time_min <= req.day_start_time_min:
            raise HTTPException(status_code=400, detail="day_end_time_min > day_start_time_min olmalı.")

        points = [req.start] + [s.coords for s in req.stops] + [req.end]
        try:
            matrix_minutes, _ = build_time_distance_matrix(points, mode=req.mode)
        except Exception:
            matrix_minutes, _ = build_haversine_matrix(points, mode=req.mode)

        n = len(points)
        if len(matrix_minutes) != n or any(len(r) != n for r in matrix_minutes):
            raise HTTPException(status_code=500, detail="time_matrix boyut hatası")

        service = [0] + [s.stay_mins for s in req.stops] + [0]
        opens   = [req.day_start_time_min] + [s.open_min if s.open_min is not None else req.day_start_time_min for s in req.stops] + [req.day_start_time_min]
        closes  = [req.day_end_time_min]   + [s.close_min if s.close_min is not None else req.day_end_time_min   for s in req.stops] + [req.day_end_time_min]
        if not (len(service) == len(opens) == len(closes) == n):
            raise HTTPException(status_code=400, detail="service/open/close uzunlukları uyuşmuyor")
        for k,(o,c) in enumerate(zip(opens,closes)):
            if o > c:
                raise HTTPException(status_code=400, detail=f"time window hatası: node {k} için open>close")

        # ---- Güvenli mod (greedy) ----
        if os.getenv("OPT_SOLVER_MODE", "").lower() in ("nn","greedy","1","true","on"):
            visited = {0}
            order_idx = [0]
            cur = 0
            while len(visited) < n-1:
                cand, best = None, 10**9
                for j in range(1, n-1):
                    if j in visited: continue
                    t = matrix_minutes[cur][j]
                    if t < best:
                        best, cand = t, j
                if cand is None: break
                visited.add(cand)
                order_idx.append(cand)
                cur = cand
            order_idx.append(n-1)

            stop_ids_order = [req.stops[i-1].id for i in order_idx if 1 <= i <= len(req.stops)]
            svc_mins_order = [service[i] for i in order_idx if 1 <= i <= len(req.stops)]
            legs = [matrix_minutes[a][b] for a,b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs) + sum(service))
            return OptimizeDayResponse(
                order=stop_ids_order,
                total_minutes=total,
                legs_minutes=[int(x) for x in legs],
                service_minutes=[int(x) for x in svc_mins_order],
                warnings=["Greedy (NN) kullanıldı."]
            )

        # ---- OR-Tools ----
        order_idx, legs_travel, total, warnings = solve_day_vrptw(
            time_matrix=matrix_minutes,
            service_times=service,
            open_mins=opens,
            close_mins=closes
        )
        stop_ids_order = [req.stops[i-1].id for i in order_idx if 1 <= i <= len(req.stops)]
        svc_mins_order = [service[i] for i in order_idx if 1 <= i <= len(req.stops)]
        return OptimizeDayResponse(
            order=stop_ids_order,
            total_minutes=int(total),
            legs_minutes=[int(x) for x in legs_travel],
            service_minutes=[int(x) for x in svc_mins_order],
            warnings=warnings
        )

    except HTTPException:
        raise
    except Exception as e:
        logging.exception("optimize-day failed")
        raise HTTPException(status_code=500, detail=f"{e.__class__.__name__}: {e}")
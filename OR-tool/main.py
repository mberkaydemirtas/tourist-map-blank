from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from typing import List, Optional, Literal, Annotated, Tuple
from dotenv import load_dotenv
import logging, os, math, traceback, time, asyncio
from multiprocessing import Process, Queue
import platform
from pathlib import Path

from matrix import build_time_distance_matrix, build_haversine_matrix
from solver import solve_day_vrptw

# ✅ .env yolunu main.py'nin yanına sabitle
ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

app = FastAPI(title="TouristMap Optimizer", version="0.3.2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TravelMode = Literal["driving", "walking", "bicycling", "transit"]

# --- env knobs ---
OPT_MAX_NODES = int(os.getenv("OPT_MAX_NODES", "64"))
USE_HAVERSINE_ONLY = os.getenv("USE_HAVERSINE_ONLY", "").lower() in ("1", "true", "on", "yes")
OPT_SOLVER_MODE = (os.getenv("OPT_SOLVER_MODE", "") or "").lower()  # "ortools" | "nn" | "greedy" | "auto"
OPT_SOLVER_TIMEOUT_SEC = int(os.getenv("OPT_SOLVER_TIMEOUT_SEC", "8"))
OPT_GREEDY_UNTIL_N = int(os.getenv("OPT_GREEDY_UNTIL_N", "4"))      # küçük N'de direkt NN
HAS_GMAPS_KEY = bool((os.getenv("GOOGLE_MAPS_API_KEY") or "").strip())
MATRIX_HARD_MAX_ELEMENTS = int(os.getenv("MATRIX_HARD_MAX_ELEMENTS", "100"))
OPT_SOLVER_ISOLATE = os.getenv("OPT_SOLVER_ISOLATE", "").lower() in ("1", "true", "on", "yes")

# Windows’ta varsayılanı güvenlik için True yapalım
if platform.system().lower().startswith("win"):
    OPT_SOLVER_ISOLATE = True if os.getenv("OPT_SOLVER_ISOLATE", "") == "" else OPT_SOLVER_ISOLATE

# ------------------------------------------------------------
# Middleware: giriş/çıkış log + süre
# ------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
    path = request.url.path
    q = request.url.query
    method = request.method
    show = path.startswith("/opt") or path.startswith("/route") or path in ("/", "/health", "/status")
    if show:
        print(f"[HTTP] {method} {path}{'?' + q if q else ''}")
    try:
        response = await call_next(request)
        return response
    except Exception:
        logging.exception("Unhandled server error (middleware)")
        raise
    finally:
        if show:
            dt = (time.time() - t0) * 1000
            print(f"[HTTP] done {method} {path} in {dt:.1f} ms")

# ------------------------------------------------------------
# Models
# ------------------------------------------------------------
class Coords(BaseModel):
    lat: float
    lon: Optional[float] = None
    lng: Optional[float] = None

    @model_validator(mode="after")
    def _unify_lon(self):
        if self.lon is None and self.lng is not None:
            self.lon = float(self.lng)
        if self.lon is None:
            raise ValueError("coords.lon/lng is required")
        try:
            lonf = float(self.lon)
            latf = float(self.lat)
        except Exception:
            raise ValueError("coords.lat/lon must be numeric")
        if not math.isfinite(lonf) or not math.isfinite(latf):
            raise ValueError("coords.lat/lon must be finite")
        if not (-90.0 <= latf <= 90.0 and -180.0 <= lonf <= 180.0):
            raise ValueError("coords out of world bounds")
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

# ------------------------------------------------------------
# Health / status
# ------------------------------------------------------------
@app.get("/")
def root():
    return {"ok": True, "service": "optimizer", "version": app.version}

@app.get("/health")
def health():
    # ✅ hızlı test için has_key'i dön
    return {"ok": True, "version": app.version, "has_gmaps_key": HAS_GMAPS_KEY}

@app.get("/status")
def status():
    return {
        "version": app.version,
        "mode": OPT_SOLVER_MODE or "auto",
        "use_haversine_only": USE_HAVERSINE_ONLY,
        "has_gmaps_key": HAS_GMAPS_KEY,
        "solver_timeout_sec": OPT_SOLVER_TIMEOUT_SEC,
        "greedy_until_n": OPT_GREEDY_UNTIL_N,
        "matrix_hard_max_elements": MATRIX_HARD_MAX_ELEMENTS,
        "opt_max_nodes": OPT_MAX_NODES,
        "solver_isolate": OPT_SOLVER_ISOLATE,
        "platform": platform.platform(),
        "env_path": str(ENV_PATH),
        "env_loaded": ENV_PATH.exists(),
    }

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------
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

def _elements(n: int) -> int:
    return n * n

# ---------- Isolated OR-Tools runner (alt-süreç) ----------
def _solver_entry(q: Queue,
                  matrix_minutes: List[List[int]],
                  service: List[int],
                  opens: List[int],
                  closes: List[int],
                  penalty_early: int,
                  penalty_late: int,
                  penalty_overtime: int,
                  allow_skipping: bool,
                  time_limit_sec: int):
    try:
        res = solve_day_vrptw(
            matrix_minutes,
            [int(x) for x in service],
            [int(x) for x in opens],
            [int(x) for x in closes],
            penalty_early=penalty_early,
            penalty_late=penalty_late,
            penalty_overtime=penalty_overtime,
            allow_skipping=allow_skipping,
            time_limit_sec=time_limit_sec,
        )
        q.put(("ok", res))
    except Exception as e:
        q.put(("err", "".join(traceback.format_exception(e))))

async def run_solver_isolated(matrix_minutes, service, opens, closes, *, time_limit_sec: int) -> Tuple[List[int], List[int], int, List[str]]:
    q: Queue = Queue()
    p = Process(
        target=_solver_entry,
        args=(
            q, matrix_minutes, service, opens, closes,
            int(os.getenv("OPT_PENALTY_EARLY", "3")),
            int(os.getenv("OPT_PENALTY_LATE", "5")),
            int(os.getenv("OPT_PENALTY_OVERTIME", "10")),
            (os.getenv("OPT_ALLOW_SKIPPING", "false").lower() in ("1", "true", "on")),
            int(time_limit_sec),
        ),
        daemon=True,
    )
    p.start()
    try:
        status, payload = await asyncio.to_thread(q.get, True, max(1, int(time_limit_sec) + 1))
        if status == "ok":
            return payload
        raise RuntimeError(f"OR-Tools (subprocess) failed:\n{payload}")
    except Exception as e:
        try:
            if p.is_alive():
                p.terminate()
        finally:
            p.join(timeout=1)
        raise e
    finally:
        try:
            if p.is_alive():
                p.terminate()
            p.join(timeout=1)
        except Exception:
            pass

# ------------------------------------------------------------
# ping
# ------------------------------------------------------------
@app.post("/optimize-day/ping")
async def ping(request: Request):
    data = await request.body()
    print(f"[OPT] /optimize-day/ping bytes={len(data)}")
    return {"ok": True}

# ------------------------------------------------------------
# main endpoint
# ------------------------------------------------------------
@app.post("/optimize-day", response_model=OptimizeDayResponse)
async def optimize_day(req: OptimizeDayRequest):
    t0 = time.time()
    print(f"[OPT] => /optimize-day start | stops={len(req.stops)} | mode={req.mode}")

    try:
        if req.day_end_time_min <= req.day_start_time_min:
            raise HTTPException(status_code=400, detail="day_end_time_min > day_start_time_min olmalı.")
        if not req.stops:
            raise HTTPException(status_code=400, detail="En az bir stop gereklidir.")
        if len(req.stops) + 2 > OPT_MAX_NODES:
            raise HTTPException(status_code=400, detail=f"Çok fazla nokta (>{OPT_MAX_NODES}).")

        points = [req.start] + [s.coords for s in req.stops] + [req.end]
        n = len(points)
        elements = _elements(n)
        print(f"[OPT] points={n} (includes start/end), matrix_elements={elements}")

        service = [0] + [int(s.stay_mins or 0) for s in req.stops] + [0]
        opens   = [int(req.day_start_time_min)] + [
            int(s.open_min) if s.open_min is not None else int(req.day_start_time_min) for s in req.stops
        ] + [int(req.day_start_time_min)]
        closes  = [int(req.day_end_time_min)] + [
            int(s.close_min) if s.close_min is not None else int(req.day_end_time_min) for s in req.stops
        ] + [int(req.day_end_time_min)]

        for k, (o, c) in enumerate(zip(opens, closes)):
            if o > c:
                raise HTTPException(status_code=400, detail=f"time window hatası: node {k} için open>close")

        force_greedy = (OPT_SOLVER_MODE in ("nn", "greedy", "1", "true", "on")) or (len(req.stops) <= OPT_GREEDY_UNTIL_N)

        t1 = time.time()
        print(f"[OPT] matrix building... haversine_only={USE_HAVERSINE_ONLY} has_key={HAS_GMAPS_KEY}")

        if USE_HAVERSINE_ONLY or (HAS_GMAPS_KEY and elements > MATRIX_HARD_MAX_ELEMENTS):
            if HAS_GMAPS_KEY and elements > MATRIX_HARD_MAX_ELEMENTS:
                logging.warning(f"[OPT] elements={elements} > {MATRIX_HARD_MAX_ELEMENTS}; using haversine.")
            matrix_minutes, _ = await asyncio.to_thread(build_haversine_matrix, points, req.mode)
        else:
            try:
                matrix_minutes, _ = await asyncio.to_thread(build_time_distance_matrix, points, req.mode)
            except Exception as e:
                logging.warning(f"[OPT] build_time_distance_matrix failed ({e}); fallback haversine.")
                matrix_minutes, _ = await asyncio.to_thread(build_haversine_matrix, points, req.mode)

        if len(matrix_minutes) != n or any(len(r) != n for r in matrix_minutes):
            raise HTTPException(status_code=500, detail="time_matrix boyut hatası")

        print(f"[OPT] matrix done in {(time.time() - t1):.2f}s")

        if len(req.stops) == 1:
            legs = [int(matrix_minutes[0][1]), int(matrix_minutes[1][n - 1])]
            total = int(sum(legs) + sum(int(x) for x in service))
            print(f"[OPT] trivial (1 stop) done in {(time.time() - t0):.2f}s")
            return OptimizeDayResponse(
                order=[req.stops[0].id],
                total_minutes=total,
                legs_minutes=legs,
                service_minutes=[int(service[1])],
                warnings=["Trivial day (1 stop)."],
            )

        if force_greedy:
            print(f"[OPT] greedy path (len(stops)={len(req.stops)}, mode={OPT_SOLVER_MODE or 'auto'})")
            order_idx = _nn_order(matrix_minutes, n)
            legs = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs) + sum(int(x) for x in service))
            order_ids = [req.stops[i - 1].id for i in order_idx if 1 <= i <= len(req.stops)]
            svc_mins_order = [int(service[i]) for i in order_idx if 1 <= i <= len(req.stops)]
            print(f"[OPT] <= greedy done in {(time.time() - t0):.2f}s")
            return OptimizeDayResponse(
                order=[str(x) for x in order_ids],
                total_minutes=int(total),
                legs_minutes=[int(x) for x in legs],
                service_minutes=[int(x) for x in svc_mins_order],
                warnings=["Greedy (NN) kullanıldı."],
            )

        t2 = time.time()
        print(f"[OPT] solver start (timeout={OPT_SOLVER_TIMEOUT_SEC}s | isolate={OPT_SOLVER_ISOLATE})")
        try:
            if OPT_SOLVER_ISOLATE:
                order_idx, legs_travel, total, warnings = await run_solver_isolated(
                    matrix_minutes, service, opens, closes, time_limit_sec=OPT_SOLVER_TIMEOUT_SEC
                )
            else:
                async def run_solver_thread():
                    return await asyncio.to_thread(
                        solve_day_vrptw,
                        matrix_minutes,
                        [int(x) for x in service],
                        [int(x) for x in opens],
                        [int(x) for x in closes],
                        penalty_early=int(os.getenv("OPT_PENALTY_EARLY", "3")),
                        penalty_late=int(os.getenv("OPT_PENALTY_LATE", "5")),
                        penalty_overtime=int(os.getenv("OPT_PENALTY_OVERTIME", "10")),
                        allow_skipping=(os.getenv("OPT_ALLOW_SKIPPING", "false").lower() in ("1", "true", "on")),
                        time_limit_sec=OPT_SOLVER_TIMEOUT_SEC,
                    )
                order_idx, legs_travel, total, warnings = await asyncio.wait_for(
                    run_solver_thread(), timeout=max(1, OPT_SOLVER_TIMEOUT_SEC + 1)
                )

            print(f"[OPT] solver done in {(time.time() - t2):.2f}s | order_len={len(order_idx)} | warnings={warnings or []}")

        except asyncio.TimeoutError:
            logging.error(f"[OPT] solver timeout > {OPT_SOLVER_TIMEOUT_SEC}s -> NN fallback")
            order_idx = _nn_order(matrix_minutes, n)
            legs_travel = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs_travel) + sum(int(x) for x in service))
            warnings = [f"Solver timeout>{OPT_SOLVER_TIMEOUT_SEC}s, Greedy (NN) fallback"]

        except Exception as e:
            logging.error("[OPT] OR-Tools failed/crashed, falling back to NN")
            logging.error(str(e))
            order_idx = _nn_order(matrix_minutes, n)
            legs_travel = [int(matrix_minutes[a][b]) for a, b in zip(order_idx[:-1], order_idx[1:])]
            total = int(sum(legs_travel) + sum(int(x) for x in service))
            warnings = ["OR-Tools failed, Greedy (NN) fallback"]

        order_ids = [req.stops[i - 1].id for i in order_idx if 1 <= i <= len(req.stops)]
        svc_mins_order = [int(service[i]) for i in order_idx if 1 <= i <= len(req.stops)]

        print(f"[OPT] <= /optimize-day done total={(time.time() - t0):.2f}s")
        return OptimizeDayResponse(
            order=[str(x) for x in order_ids],
            total_minutes=int(total),
            legs_minutes=[int(x) for x in legs_travel],
            service_minutes=[int(x) for x in svc_mins_order],
            warnings=[str(w) for w in (warnings or [])],
        )

    except HTTPException:
        raise
    except Exception as e:
        logging.exception("optimize-day failed (outer)")
        raise HTTPException(status_code=500, detail=f"{e.__class__.__name__}: {e}")

# ------------------------------------------------------------
# Local run
# ------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    # ✅ LAN + cihaz için doğru host: 0.0.0.0
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8001")), reload=False, log_level="debug")

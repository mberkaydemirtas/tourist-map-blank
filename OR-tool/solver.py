from typing import List, Tuple, Optional, Sequence
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
import math

# ===== Güvenli sabitler =====
INT_MAX = 10**9
DAY_HORIZON = 24 * 60  # 1 gün (dakika)

# ===== Yardımcılar: veri doğrulama & sanitizasyon =====
def _is_bad(x):
    return x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))

def sanitize_cost_matrix(mat):
    n = len(mat)
    BIG = INT_MAX // 4
    CAP = INT_MAX // 2
    out = [[0]*n for _ in range(n)]
    for i in range(n):
        row = mat[i]
        if len(row) != n:
            raise ValueError(f"time_matrix not square at row {i}: {len(row)} != {n}")
        for j in range(n):
            v = row[j]
            if _is_bad(v):
                v = BIG
            if v < 0:
                v = 0
            if v > CAP:
                v = CAP
            out[i][j] = int(v)
    return out

def sanitize_service_times(svc):
    CAP = INT_MAX // 4
    out = []
    for v in svc:
        if _is_bad(v) or v < 0:
            v = 0
        if v > CAP:
            v = CAP
        out.append(int(v))
    return out

def clamp_day_range(open_mins, close_mins, horizon=DAY_HORIZON):
    if not open_mins or not close_mins:
        return 0, horizon
    day_start = max(0, min(open_mins))
    day_end = min(horizon, max(close_mins))
    if day_end < 0:
        day_end = 0
    if day_start > day_end:
        day_start, day_end = day_end, day_start
    return int(day_start), int(day_end)

# ===== Çözüm =====
def _solve_with_params(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    cb_idx: int,
    open_mins: List[int],
    close_mins: List[int],
    *,
    penalty_early: int = 0,    # open'dan önce varış (bekleme) için ceza
    penalty_late: int = 0,     # close'dan sonra varış için ceza
    penalty_overtime: int = 0, # gün sonunu geçme için ek ceza (end node)
    allow_skipping: bool = False,
    skip_penalties: Optional[Sequence[int]] = None,  # node bazlı atlama cezası (1..n-2)
    time_limit_sec: int = 8,
) -> Tuple[List[int], List[int]] | None:

    # Horizon ve gün aralığını güvenli kıl
    day_start, day_end = clamp_day_range(open_mins, close_mins, DAY_HORIZON)
    capacity = max(DAY_HORIZON, day_end)

    # Zaman boyutu
    routing.AddDimension(
        cb_idx,
        capacity,   # slack
        capacity,   # horizon
        False,      # start zamanını 0'a sabitleme
        "Time"
    )
    time_dim = routing.GetDimensionOrDie("Time")

    n = manager.GetNumberOfNodes()

    # Sert aralık + soft cezalar
    for node in range(n):
        idx = manager.NodeToIndex(node)
        time_dim.CumulVar(idx).SetRange(day_start, day_end)

        if penalty_early > 0:
            lo = max(day_start, int(open_mins[node]))
            time_dim.SetCumulVarSoftLowerBound(idx, lo, int(penalty_early))
        if penalty_late > 0:
            hi = min(day_end, int(close_mins[node]))
            time_dim.SetCumulVarSoftUpperBound(idx, hi, int(penalty_late))

    # Gün sonunu geçmeye ek ceza (end)
    if penalty_overtime > 0:
        end_idx = manager.NodeToIndex(n - 1)
        hi = min(day_end, int(close_mins[n - 1]))
        time_dim.SetCumulVarSoftUpperBound(end_idx, hi, int(penalty_overtime))

    # Node atlama (disjunction)
    if allow_skipping:
        default_skip = 2000
        for node in range(1, n - 1):
            penalty = int(skip_penalties[node - 1]) if (skip_penalties and node - 1 < len(skip_penalties)) else default_skip
            routing.AddDisjunction([manager.NodeToIndex(node)], max(0, penalty))

    # Arama parametreleri
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH

    # Dışarıdan gelen limit → asıl limit
    # (güvenlik için 1..30 aralığına sıkıştıralım)
    hard_limit = max(1, min(int(time_limit_sec), 30))
    params.time_limit.seconds = hard_limit
    # params.log_search = False  # debug gerekirse True

    sol = routing.SolveWithParameters(params)
    if sol is None:
        return None

    # Rotayı çıkar
    index = routing.Start(0)
    order: List[int] = []
    legs: List[int] = []
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        order.append(node)
        nxt = sol.Value(routing.NextVar(index))
        if not routing.IsEnd(nxt):
            legs.append(routing.GetArcCostForVehicle(index, nxt, 0))
        index = nxt
    order.append(manager.IndexToNode(index))  # end
    return order, legs

def _build_and_solve(
    time_matrix: List[List[int]],
    service_times: List[int],
    open_mins: List[int],
    close_mins: List[int],
    include_service: bool,
    *,
    penalty_early: int = 0,
    penalty_late: int = 0,
    penalty_overtime: int = 0,
    allow_skipping: bool = False,
    skip_penalties: Optional[Sequence[int]] = None,
    time_limit_sec: int = 8,
) -> Tuple[List[int], List[int]] | None:
    """
    include_service=True  -> transit = travel(i->j) + service(i)
    include_service=False -> transit = travel(i->j)
    Döner: (node_order, legs_travel_minutes) veya None
    """
    n = len(time_matrix)
    if n < 2:
        return [0], []

    # Sanitizasyon
    time_matrix = sanitize_cost_matrix(time_matrix)
    service_times = sanitize_service_times(service_times)

    if not (len(open_mins) == len(close_mins) == n == len(service_times)):
        raise ValueError("length mismatch in inputs")

    # (erken patlasın) horizon clamp testi
    _ds, _de = clamp_day_range(open_mins, close_mins, DAY_HORIZON)

    manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n - 1])
    routing = pywrapcp.RoutingModel(manager)

    def transit_cb(from_index, to_index):
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        v = int(time_matrix[i][j])
        if include_service:
            v += int(service_times[i])
        if v < 0:
            v = 0
        elif v > INT_MAX:
            v = INT_MAX
        return v

    cb_idx = routing.RegisterTransitCallback(transit_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

    return _solve_with_params(
        routing,
        manager,
        cb_idx,
        [int(x) for x in open_mins],
        [int(x) for x in close_mins],
        penalty_early=penalty_early,
        penalty_late=penalty_late,
        penalty_overtime=penalty_overtime,
        allow_skipping=allow_skipping,
        skip_penalties=skip_penalties,
        time_limit_sec=time_limit_sec,
    )

def solve_day_vrptw(
    time_matrix: List[List[int]],
    service_times: List[int],
    open_mins: List[int],
    close_mins: List[int],
    *,
    penalty_early: int = 0,      # open'dan önce bekleme cezası
    penalty_late: int = 0,       # close'dan sonra varış cezası
    penalty_overtime: int = 0,   # gün sonunu geçme cezası (end node)
    allow_skipping: bool = False,
    node_weights: Optional[Sequence[float]] = None,  # önem katsayıları (1..n-2)
    skip_base_penalty: int = 2000,
    time_limit_sec: int = 8,
) -> Tuple[List[int], List[int], int, List[str]]:
    """
    Tek araç: start=0, end=last; duraklar 1..N-2
    Döner: (node_order, legs_travel_minutes, total_minutes(travel+service), warnings)
    """
    warnings: List[str] = []

    # node bazlı atlama cezasını ağırlıkla modüle et
    sp: Optional[List[int]] = None
    if allow_skipping:
        sp = []
        for idx in range(1, len(time_matrix) - 1):
            w = 0.0
            if node_weights and idx - 1 < len(node_weights) and node_weights[idx - 1] is not None:
                w = float(node_weights[idx - 1])
            penalty = int(skip_base_penalty + 200.0 * w)
            sp.append(penalty)

    # 1) Servis dahil
    res = _build_and_solve(
        time_matrix, service_times, open_mins, close_mins, include_service=True,
        penalty_early=penalty_early,
        penalty_late=penalty_late,
        penalty_overtime=penalty_overtime,
        allow_skipping=allow_skipping,
        skip_penalties=sp,
        time_limit_sec=time_limit_sec,
    )
    if res is not None:
        order, legs = res
        total = int(sum(legs) + sum(service_times))
        return order, legs, total, warnings

    # 2) Servis hariç fallback
    res = _build_and_solve(
        time_matrix, service_times, open_mins, close_mins, include_service=False,
        penalty_early=penalty_early,
        penalty_late=penalty_late,
        penalty_overtime=penalty_overtime,
        allow_skipping=allow_skipping,
        skip_penalties=sp,
        time_limit_sec=time_limit_sec,
    )
    if res is not None:
        order, legs = res
        total = int(sum(legs) + sum(service_times))
        warnings.append("Servis süreleri yoksayılıp çözüm bulundu.")
        return order, legs, total, warnings

    # 3) Son çare: düz sıra
    n = len(time_matrix)
    order = list(range(n))
    legs = [int(time_matrix[a][b]) for a, b in zip(order[:-1], order[1:])]
    total = int(sum(legs) + sum(service_times))
    warnings.append("Feasible çözüm bulunamadı, basit sıralama uygulandı.")
    return order, legs, total, warnings

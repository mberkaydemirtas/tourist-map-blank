# OR-tool/solver.py
from typing import List, Tuple, Optional, Sequence
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
import math

INT_MAX = 10**9
DAY_HORIZON = 24 * 60  # minutes

def _is_bad(x):
    return x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))

def sanitize_cost_matrix(mat):
    n = len(mat)
    BIG = INT_MAX // 4
    CAP = INT_MAX // 2
    out = [[0] * n for _ in range(n)]
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

def _solve_with_params(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    cb_idx: int,
    open_mins: List[int],
    close_mins: List[int],
    time_matrix: List[List[int]],
    service_times: List[int],
    include_service: bool,
    *,
    penalty_early: int = 0,
    penalty_late: int = 0,
    penalty_overtime: int = 0,
    allow_skipping: bool = False,
    skip_penalties: Optional[Sequence[int]] = None,
    time_limit_sec: int = 8,
) -> Tuple[List[int], List[int], int] | None:
    """
    Returns: (node_order, legs_travel_minutes, total_minutes)
    node_order includes start(0) and end(n-1).
    legs_travel_minutes includes travel for each leg in the returned path (same length as edges).
    total_minutes = travel + service(visited stops only) [no double-count]
    """

    day_start, day_end = clamp_day_range(open_mins, close_mins, DAY_HORIZON)
    capacity = max(DAY_HORIZON, day_end)

    routing.AddDimension(
        cb_idx,
        capacity,
        capacity,
        False,
        "Time"
    )
    time_dim = routing.GetDimensionOrDie("Time")
    n = manager.GetNumberOfNodes()

    for node in range(n):
        idx = manager.NodeToIndex(node)
        time_dim.CumulVar(idx).SetRange(day_start, day_end)

        if penalty_early > 0:
            lo = max(day_start, int(open_mins[node]))
            time_dim.SetCumulVarSoftLowerBound(idx, lo, int(penalty_early))
        if penalty_late > 0:
            hi = min(day_end, int(close_mins[node]))
            time_dim.SetCumulVarSoftUpperBound(idx, hi, int(penalty_late))

    if penalty_overtime > 0:
        end_idx = manager.NodeToIndex(n - 1)
        hi = min(day_end, int(close_mins[n - 1]))
        time_dim.SetCumulVarSoftUpperBound(end_idx, hi, int(penalty_overtime))

    if allow_skipping:
        default_skip = 2000
        for node in range(1, n - 1):
            penalty = int(skip_penalties[node - 1]) if (skip_penalties and node - 1 < len(skip_penalties)) else default_skip
            routing.AddDisjunction([manager.NodeToIndex(node)], max(0, penalty))

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH

    hard_limit = max(1, min(int(time_limit_sec), 30))
    params.time_limit.seconds = hard_limit

    sol = routing.SolveWithParameters(params)
    if sol is None:
        return None

    index = routing.Start(0)
    order: List[int] = []
    legs_travel: List[int] = []
    service_sum = 0

    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        order.append(node)

        nxt = sol.Value(routing.NextVar(index))
        if routing.IsEnd(nxt):
            break

        next_node = manager.IndexToNode(nxt)

        # travel is always from time_matrix
        legs_travel.append(int(time_matrix[node][next_node]))

        # service belongs to "from" node if include_service; but count service only for real stops (1..n-2)
        if 1 <= node <= (n - 2):
            service_sum += int(service_times[node])

        index = nxt

    # append end
    end_node = manager.IndexToNode(sol.Value(routing.NextVar(index))) if not routing.IsEnd(index) else manager.IndexToNode(index)
    if order[-1] != (n - 1):
        order.append(n - 1)

    total = int(sum(legs_travel) + service_sum)
    return order, legs_travel, total

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
) -> Tuple[List[int], List[int], int] | None:

    n = len(time_matrix)
    if n < 2:
        return [0], [], 0

    time_matrix = sanitize_cost_matrix(time_matrix)
    service_times = sanitize_service_times(service_times)

    if not (len(open_mins) == len(close_mins) == n == len(service_times)):
        raise ValueError("length mismatch in inputs")

    clamp_day_range(open_mins, close_mins, DAY_HORIZON)

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
        time_matrix=time_matrix,
        service_times=service_times,
        include_service=include_service,
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
    penalty_early: int = 0,
    penalty_late: int = 0,
    penalty_overtime: int = 0,
    allow_skipping: bool = False,
    node_weights: Optional[Sequence[float]] = None,
    skip_base_penalty: int = 2000,
    time_limit_sec: int = 8,
) -> Tuple[List[int], List[int], int, List[str]]:
    warnings: List[str] = []

    sp: Optional[List[int]] = None
    if allow_skipping:
        sp = []
        for idx in range(1, len(time_matrix) - 1):
            w = 0.0
            if node_weights and idx - 1 < len(node_weights) and node_weights[idx - 1] is not None:
                w = float(node_weights[idx - 1])
            penalty = int(skip_base_penalty + 200.0 * w)
            sp.append(penalty)

    # 1) include service in dimension/cost (more realistic)
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
        order, legs_travel, total = res
        return order, legs_travel, total, warnings

    # 2) fallback without service in transit
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
        order, legs_travel, total = res
        warnings.append("Servis süreleri transit maliyetinden çıkarılarak çözüm bulundu.")
        return order, legs_travel, total, warnings

    n = len(time_matrix)
    order = list(range(n))
    legs = [int(time_matrix[a][b]) for a, b in zip(order[:-1], order[1:])]
    total = int(sum(legs) + sum(service_times[1:-1]))
    warnings.append("Feasible çözüm bulunamadı, basit sıralama uygulandı.")
    return order, legs, total, warnings

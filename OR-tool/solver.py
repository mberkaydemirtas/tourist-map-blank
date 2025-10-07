# OR-tool/solver.py
from typing import List, Tuple
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

def _build_and_solve(time_matrix: List[List[int]],
                     service_times: List[int],
                     open_mins: List[int],
                     close_mins: List[int],
                     include_service: bool) -> Tuple[List[int], List[int]] | None:
    """
    include_service=True  -> transit = travel(i->j) + service(i)
    include_service=False -> transit = travel(i->j)
    Döner: (order, legs_travel) veya None
    """
    n = len(time_matrix)
    if n < 2:
        return [0], []

    # Start=0, End=n-1  --> *** mutlaka liste ver ***
    manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n - 1])
    routing = pywrapcp.RoutingModel(manager)

    def transit_cb(from_index, to_index):
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        if include_service:
            return time_matrix[i][j] + service_times[i]
        return time_matrix[i][j]

    cb_idx = routing.RegisterTransitCallback(transit_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

    routing.AddDimension(
        cb_idx,
        60,        # max waiting/slack
        24 * 60,   # horizon
        False,     # start'ı 0'a sabitleme
        "Time"
    )
    time_dim = routing.GetDimensionOrDie("Time")

    # Node bazlı time windows
    for node in range(n):
        idx = manager.NodeToIndex(node)     # <- kritik
        time_dim.CumulVar(idx).SetRange(open_mins[node], close_mins[node])

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = 2

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
            nn = manager.IndexToNode(nxt)
            legs.append(time_matrix[node][nn])  # sadece travel
        index = nxt
    order.append(manager.IndexToNode(index))  # end

    return order, legs


def solve_day_vrptw(time_matrix: List[List[int]],
                    service_times: List[int],
                    open_mins: List[int],
                    close_mins: List[int]) -> Tuple[List[int], List[int], int, List[str]]:
    """
    Tek araç: start=0, end=last; duraklar 1..N
    Döner: (node_order, legs_travel_minutes, total_minutes(travel+service), warnings)
    """
    warnings: List[str] = []

    # 1) Servis dahil deneyelim
    res = _build_and_solve(time_matrix, service_times, open_mins, close_mins, include_service=True)
    if res is not None:
        order, legs = res
        total = sum(legs) + sum(service_times)
        return order, legs, total, warnings

    # 2) Servis hariç fallback
    res = _build_and_solve(time_matrix, service_times, open_mins, close_mins, include_service=False)
    if res is not None:
        order, legs = res
        total = sum(legs) + sum(service_times)
        warnings.append("Servis süreleri yoksayılıp çözüm bulundu.")
        return order, legs, total, warnings

    # 3) Son çare: düz sıra
    n = len(time_matrix)
    order = list(range(n))
    legs = [time_matrix[a][b] for a, b in zip(order[:-1], order[1:])]
    total = sum(legs) + sum(service_times)
    warnings.append("Feasible çözüm bulunamadı, basit sıralama uygulandı.")
    return order, legs, total, warnings

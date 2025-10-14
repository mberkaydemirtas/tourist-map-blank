from typing import List, Tuple, Optional, Sequence
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


def _solve_with_params(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    cb_idx: int,
    open_mins: List[int],
    close_mins: List[int],
    *,
    # soft bounds penalties (dakika başı ceza puanı)
    penalty_early: int = 0,    # open'dan önce varış (bekleme) için ceza (0 = kapalı)
    penalty_late: int = 0,     # close'dan sonra varış için ceza
    penalty_overtime: int = 0, # gün sonunu geçme için ek ceza (end node'da)
    allow_skipping: bool = False,
    skip_penalties: Optional[Sequence[int]] = None,  # node bazlı atlama cezası (1..n-2)
) -> Tuple[List[int], List[int]] | None:
    """
    Routing modeli çözer; (node_order, legs_travel_minutes) döner.
    - Soft lower/upper bound'larla erken/geç varış cezaları ekler.
    - İstenirse disjunction ile node atlama (skip) cezası tanımlar.
    """
    # Zaman boyutu: transit = travel (+ service) callback'te
    routing.AddDimension(
        cb_idx,
        24 * 60,   # slack/awaiting (geniş; feasibility'yi arttırır)
        24 * 60,   # horizon (1 gün)
        False,     # start zamanını 0'a sabitleme
        "Time"
    )
    time_dim = routing.GetDimensionOrDie("Time")

    n = manager.GetNumberOfNodes()

    # Sert aralık: gün başlangıcı/sonu (open/close'dan geniş)
    # Soft bound'lar node bazında “tercih edilen” aralığı cezayla uygular.
    day_start = min(open_mins) if open_mins else 0
    day_end   = max(close_mins) if close_mins else 24 * 60

    for node in range(n):
        idx = manager.NodeToIndex(node)
        time_dim.CumulVar(idx).SetRange(day_start, day_end)

        # Soft lower/upper (erken/ geç ceza)
        if penalty_early > 0:
            time_dim.SetCumulVarSoftLowerBound(idx, open_mins[node], penalty_early)
        if penalty_late > 0:
            time_dim.SetCumulVarSoftUpperBound(idx, close_mins[node], penalty_late)

    # Gün sonunu geçmeye ek ceza (opsiyonel, end node'a daha büyük ceza)
    if penalty_overtime > 0:
        end_idx = manager.NodeToIndex(n - 1)
        time_dim.SetCumulVarSoftUpperBound(end_idx, close_mins[n - 1], penalty_overtime)

    # Node atlamayı opsiyonel kıl (disjunction). 1..n-2 müşteri düğümleri.
    if allow_skipping:
        # skip_penalties verilmemişse sabit (ör. 2000) uygula.
        default_skip = 2000
        for node in range(1, n - 1):
            penalty = int(skip_penalties[node - 1]) if (skip_penalties and node - 1 < len(skip_penalties)) else default_skip
            routing.AddDisjunction([manager.NodeToIndex(node)], penalty)

    # Arama parametreleri (dinamik zaman limiti)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH

    if n <= 10:
        params.time_limit.seconds = 1
    elif n <= 18:
        params.time_limit.seconds = 2
    elif n <= 30:
        params.time_limit.seconds = 3
    else:
        params.time_limit.seconds = 5

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
            # Legs sadece travel süresi (service hariç)
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
) -> Tuple[List[int], List[int]] | None:
    """
    include_service=True  -> transit = travel(i->j) + service(i)
    include_service=False -> transit = travel(i->j)
    Döner: (node_order, legs_travel_minutes) veya None
    """
    n = len(time_matrix)
    if n < 2:
        return [0], []

    manager = pywrapcp.RoutingIndexManager(n, 1, [0], [n - 1])
    routing = pywrapcp.RoutingModel(manager)

    def transit_cb(from_index, to_index):
        i = manager.IndexToNode(from_index)
        j = manager.IndexToNode(to_index)
        if include_service:
            return int(time_matrix[i][j]) + int(service_times[i])
        return int(time_matrix[i][j])

    cb_idx = routing.RegisterTransitCallback(transit_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

    return _solve_with_params(
        routing,
        manager,
        cb_idx,
        open_mins,
        close_mins,
        penalty_early=penalty_early,
        penalty_late=penalty_late,
        penalty_overtime=penalty_overtime,
        allow_skipping=allow_skipping,
        skip_penalties=skip_penalties,
    )


def solve_day_vrptw(
    time_matrix: List[List[int]],
    service_times: List[int],
    open_mins: List[int],
    close_mins: List[int],
    *,
    # --- yeni: ceza parametreleri (opsiyonel) ---
    penalty_early: int = 0,      # örn 3: open'dan önce dakikabaşı 3 ceza
    penalty_late: int = 0,       # örn 5: close'dan sonra dakikabaşı 5 ceza
    penalty_overtime: int = 0,   # örn 10: gün sonunu geçme dakikabaşı 10 ceza (end node)
    allow_skipping: bool = False,
    node_weights: Optional[Sequence[float]] = None,  # önem katsayıları (1..n-2) — atlama cezasında kullanılabilir
    skip_base_penalty: int = 2000,                   # yüksek = atlamayı zorlaştırır
) -> Tuple[List[int], List[int], int, List[str]]:
    """
    Tek araç: start=0, end=last; duraklar 1..N-2
    Döner: (node_order, legs_travel_minutes, total_minutes(travel+service), warnings)

    Notlar:
      - Soft bound'lar sayesinde open/close dışına çıkmak mümkün ama pahalı.
      - allow_skipping=True ise bazı node'lar disjunction ile atlanabilir (ceza ödenir).
      - node_weights yüksekse (örn 5), atlama cezası büyür; düşükse küçülür.
    """
    warnings: List[str] = []

    # node bazlı atlama cezasını (disjunction) ağırlıkla modüle et
    skip_penalties = None
    if allow_skipping:
        skip_penalties = []
        # 1..n-2 müşteri düğümleri için weight → ceza
        # weight aralığını [0..5] varsayalım; ceza = skip_base_penalty + 200 * weight
        for idx in range(1, len(time_matrix) - 1):
            w = 0.0
            if node_weights and idx - 1 < len(node_weights) and node_weights[idx - 1] is not None:
                w = float(node_weights[idx - 1])
            penalty = int(skip_base_penalty + 200.0 * w)
            skip_penalties.append(penalty)

    # 1) Servis dahil
    res = _build_and_solve(
        time_matrix, service_times, open_mins, close_mins, include_service=True,
        penalty_early=penalty_early,
        penalty_late=penalty_late,
        penalty_overtime=penalty_overtime,
        allow_skipping=allow_skipping,
        skip_penalties=skip_penalties,
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
        skip_penalties=skip_penalties,
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

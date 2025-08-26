// src/map/services/routeService.js
// Rota/Directions ile ilgili servisler — şimdilik maps.js'e forward.
import * as Maps from '../map/maps';

/** Directions API (tek/çoklu rota) */
export const getRoute = Maps.getRoute;

/** Polyline decode helper */
export const decodePolyline = Maps.decodePolyline;

// İleride normalize edilmiş bir buildRoute ekleyebiliriz.
// export async function buildRoute({ from, to, waypoints = [], mode = 'driving' }) { ... }

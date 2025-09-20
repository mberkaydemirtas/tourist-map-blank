// services/routeService.js
import * as Maps from '../../map/maps';

export const getRoute = Maps.getRoute;
export const decodePolyline = Maps.decodePolyline;

/**
 * Belirli bir mod için normalize rota listesi döndürür.
 * - polyline decode edilir
 * - id ve mode alanları atanır
 * - boş/geçersiz geometri ayıklanır
 */
export async function getNormalizedRoutes({
  from,
  to,
  mode = 'driving',
  options = {},
}) {
  const out = await getRoute(from, to, mode, options);
  const list = (Array.isArray(out) ? out : out ? [out] : [])
    .map((r, i) => ({
      ...r,
      decodedCoords: r.decodedCoords || decodePolyline(r.polyline || ''),
      id: `${mode}-${i}`,
      isPrimary: i === 0,
      mode,
    }))
    .filter((r) => (r.decodedCoords?.length ?? 0) > 1);

  return list;
}

/**
 * Birden çok mod için normalize rota listeleri döndürür.
 * { driving: RouteModel[], walking: RouteModel[], transit: RouteModel[] }
 */
export async function getAllModesNormalized({
  from,
  to,
  modes = ['driving', 'walking', 'transit'],
  optionsPerMode = {},
}) {
  const routeMap = {};
  for (const m of modes) {
    routeMap[m] = await getNormalizedRoutes({
      from,
      to,
      mode: m,
      options: optionsPerMode[m] ?? {},
    });
  }
  return routeMap;
}

 // src/utils/coords.js
 export function normalizeCoord(input) {
   if (!input) return null;
   const c =
     input.coords ??
     input.coordinate ??
     input.location ??
     input.geometry?.location ??
     input;
   const latitude =
     c?.latitude ?? c?.lat ?? (Array.isArray(c) && typeof c[0] === 'number' ? c[0] : undefined);
   const longitude =
     c?.longitude ?? c?.lng ?? (Array.isArray(c) && typeof c[1] === 'number' ? c[1] : undefined);
   if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
   return { latitude, longitude };
 }

 export function toCoordsObject(x) {
   const n = normalizeCoord(x);
   return n ? { coords: n } : null;
 }

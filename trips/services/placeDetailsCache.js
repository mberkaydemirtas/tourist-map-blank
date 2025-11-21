// trips/services/placeDetailsCache.js
import { getPlaceDetails } from '../../map/maps';
import { coercePhotoInputsToUrls } from '../utils/placeUtils';
import Constants from 'expo-constants';

const detailsCache = new Map();
const inFlightDetails = new Map();

const API_KEY =
  Constants?.expoConfig?.extra?.GOOGLE_MAPS_API_KEY ||
  Constants?.manifest?.extra?.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  global?.GOOGLE_MAPS_API_KEY ||
  '';

export async function getDetailsWithCache(placeId) {
  if (!placeId) return null;

  const cached = detailsCache.get(placeId);
  if (cached && Date.now() - cached.ts < 1000 * 60 * 30) return cached.data;
  if (inFlightDetails.has(placeId)) return inFlightDetails.get(placeId);

  const p = (async () => {
    try {
      const det = await getPlaceDetails(placeId);
      let photos = [];
      if (Array.isArray(det?.photos)) {
        photos = coercePhotoInputsToUrls(det.photos, API_KEY);
      }
      const norm = det ? { coords: det.coords, name: det.name, address: det.address, photos } : null;
      if (norm) detailsCache.set(placeId, { data: norm, ts: Date.now() });
      return norm;
    } catch (e) {
      return null;
    } finally {
      inFlightDetails.delete(placeId);
    }
  })();

  inFlightDetails.set(placeId, p);
  return p;
}

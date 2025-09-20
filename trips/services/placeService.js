// src/map/services/placeService.js
// maps.js üstüne ince bir arayüz. Şimdilik doğrudan forward ediyoruz.
import * as Maps from '../../map/maps';

/** Yer önerileri (Autocomplete) */
export const autocomplete = Maps.autocomplete;

/** Place Details */
export const getPlaceDetails = Maps.getPlaceDetails;

/** Yakındaki yerler (Nearby Search) */
export const getNearbyPlaces = Maps.getNearbyPlaces;

/** Koordinattan adres (Reverse Geocoding) */
export const getAddressFromCoords = Maps.getAddressFromCoords;

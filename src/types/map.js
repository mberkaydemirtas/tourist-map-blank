/**
 * @typedef {Object} LatLng
 * @property {number} latitude
 * @property {number} longitude
 */

/**
 * @typedef {Object} Place
 * @property {string=} place_id
 * @property {string} name
 * @property {string=} address
 * @property {LatLng} coords
 * @property {number=} rating
 * @property {Array=} photos
 * @property {Array=} reviews
 * @property {string[]=} types
 */

/**
 * @typedef {Object} RouteModel
 * @property {number} distance    // metres
 * @property {number} duration    // seconds
 * @property {string=} polyline
 * @property {LatLng[]=} decodedCoords
 * @property {boolean=} isPrimary
 * @property {string=} id
 * @property {'driving'|'walking'|'transit'=} mode
 * @property {number[]=} waypointOrder
 */

// src/shared/tripsRepo.js
let _driver = null;

export function setTripsDriver(driver) { _driver = driver; }
export function listTrips() { return _driver.listTrips(); }
export function getTrip(id) { return _driver.getTrip(id); }
export function createTrip(init = {}) { return _driver.createTrip(init); }
export function updateTrip(id, patch, expectedVersion) { return _driver.updateTrip(id, patch, expectedVersion); }
export function deleteTrip(id) { return _driver.deleteTrip(id); }
export function duplicateTrip(id) { return _driver.duplicateTrip(id); }
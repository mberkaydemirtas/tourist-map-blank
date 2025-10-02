// src/shared/plansRepo.js
let _driver = null;

export function setPlansDriver(driver) {
  _driver = driver;
}

const key = (tripId) => `plan:${tripId}`;

export async function getPlanByTripId(tripId) {
  if (!_driver) throw new Error('[plansRepo] driver is not set');
  return _driver.get(key(tripId));
}

export async function savePlan(plan) {
  if (!_driver) throw new Error('[plansRepo] driver is not set');
  if (!plan?.tripId) throw new Error('[plansRepo] invalid plan (missing tripId)');
  return _driver.set(key(plan.tripId), plan);
}

export async function removePlan(tripId) {
  if (!_driver) throw new Error('[plansRepo] driver is not set');
  return _driver.remove(key(tripId));
}

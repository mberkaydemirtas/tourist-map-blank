// utils/dlog.js
export const DEBUG = true;
export const dlog = (...args) => DEBUG && console.log('[MAP]', ...args);
export const flog = (...args) => DEBUG && console.log('%c[FLOW]', 'color:#6a5acd', ...args);
export const rlog = (...args) => DEBUG && console.log('%c[ROUTE]', 'color:#0a84ff', ...args);
export const xlog = (...args) => DEBUG && console.log('%c[XRAY]', 'color:#ff3b30', ...args);

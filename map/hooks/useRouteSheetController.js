// hooks/useRouteSheetController.js
import { useCallback, useRef } from 'react';


/**
* Controls presentation state of RouteInfoSheet in a safe, idempotent way.
* Usage:
* const sheetRef = useRef(null)
* const routeSheet = useRouteSheetController(sheetRef)
* routeSheet.present()
* routeSheet.dismiss()
*/
export function useRouteSheetController(sheetRef) {
const presentedRef = useRef(false);
const resumeAfterNavRef = useRef(false);


const present = useCallback(() => {
const r = sheetRef?.current;
if (!r || presentedRef.current) return;
r.present?.();
r.expand?.();
r.snapToIndex?.(0);
presentedRef.current = true;
}, [sheetRef]);


const dismiss = useCallback(() => {
const r = sheetRef?.current;
if (!r) return;
r.dismiss?.();
r.close?.();
presentedRef.current = false;
}, [sheetRef]);


return { present, dismiss, presentedRef, resumeAfterNavRef };
}
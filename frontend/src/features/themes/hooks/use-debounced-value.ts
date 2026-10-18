import { useEffect, useState } from "react";

/** De waarde, maar pas `delay` ms nadat ze niet meer veranderde (bv. zoektekst → query). */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, debounced, delay]);
  return debounced;
}

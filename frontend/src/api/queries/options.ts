import type { InfiniteData } from "@tanstack/react-query";

/** Opties die elke lees-hook doorgeeft aan `useQuery`. */
export interface QueryHookOptions {
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
}

/** Alle items van een infinite query achter elkaar (voor lijsten met "meer laden"). */
export function flattenPages<T>(data: InfiniteData<{ items: T[] }, unknown> | undefined): T[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

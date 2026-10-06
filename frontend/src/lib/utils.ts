import { clsx, type ClassValue } from "clsx";
import type { Ref, RefCallback } from "react";
import { twMerge } from "tailwind-merge";

/** Klassen samenvoegen en conflicterende Tailwind-utilities oplossen (laatste wint). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Meerdere refs (callback of object) op hetzelfde element zetten. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) ref.current = value;
    }
  };
}

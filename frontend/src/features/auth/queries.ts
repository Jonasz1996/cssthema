import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, send, subscribeAuthChanged } from "@/api/client";
import type { components } from "@/api/schema";

export type AuthState = components["schemas"]["AuthState"];

export const AUTH_KEY = ["auth", "me"] as const;

/** Wie is aangemeld (`GET /auth/me`); herlaadt na een 401/403 van een andere call. */
export function useAuthState() {
  const client = useQueryClient();
  useEffect(
    () => subscribeAuthChanged(() => void client.invalidateQueries({ queryKey: AUTH_KEY })),
    [client],
  );
  return useQuery({
    queryKey: AUTH_KEY,
    queryFn: async ({ signal }) => (await send(api.GET("/api/v1/auth/me", { signal }))).data,
    staleTime: 60_000,
  });
}

/** Na aanmelden, wachtwoord of MFA: de nieuwe toestand in de cache, de rest opnieuw laden. */
export function useSetAuthState() {
  const client = useQueryClient();
  return (state: AuthState) => {
    client.setQueryData(AUTH_KEY, state);
    if (state.user && !state.must_change_password && !state.mfa_setup_required) {
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    }
  };
}

/**
 * Het commando voor de beheerder. Een e-mailadres met tekens buiten de gewone set komt tussen
 * enkele aanhalingstekens, zodat het letterlijk gekopieerd en geplakt kan worden.
 */
export function resetCommand(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(value)) return null;
  const safe = /^[a-z0-9@._+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  return `cssthema-account reset ${safe}`;
}

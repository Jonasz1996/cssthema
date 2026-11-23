import type { ReactNode } from "react";
import { LoginScreen, SetupScreen } from "./AuthScreens";
import { useAuthState } from "./queries";

/**
 * Met AUTH_MODE=lokaal: eerst aanmelden (en bij de eerste aanmelding wachtwoord + MFA), dan
 * pas het dashboard. Met AUTH_MODE=geen (standaard) of als /auth/me faalt: meteen het
 * dashboard, zoals vroeger; de api weigert zelf wat niet mag.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  // Tijdens het laden al het dashboard: zonder login (de standaard) is er niets te wachten.
  const { data } = useAuthState();
  if (data?.mode !== "lokaal") return children;
  if (!data.user) return <LoginScreen />;
  if (data.must_change_password || data.mfa_setup_required) return <SetupScreen state={data} />;
  return children;
}

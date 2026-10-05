import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createQueryClient } from "./query-client";
import { routes } from "./routes";

const router = createBrowserRouter(routes);

/**
 * Een taalwissel remount hier niets: componenten vertalen met `useI18n()` en renderen zelf
 * opnieuw, zodat focus, formulieren en open dialogen blijven staan.
 */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

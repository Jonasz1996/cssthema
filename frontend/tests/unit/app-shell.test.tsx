import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app/App";
import { AppShell } from "@/app/AppShell";
import { useShellCommand } from "@/app/shell-command";
import { useUiStore } from "@/app/ui-store";
import { useI18n } from "@/lib/i18n";
import { setReducedMotion } from "../helpers";
import { renderApp, stubHealth } from "../render-app";

function terminalCommand(): string | null {
  return (
    document.querySelector("[data-terminal-command]")?.getAttribute("data-terminal-command") ?? null
  );
}

function navLinks() {
  const nav = screen.getByRole("navigation", { name: "Hoofdnavigatie" });
  return within(nav).getAllByRole("link");
}

describe("App-shell", () => {
  beforeEach(() => stubHealth());

  it("toont de terminalbalk met het commando van de route", () => {
    renderApp("/");
    expect(screen.getByText("root@jbogaert:~# cssthema dashboard")).toBeInTheDocument();
  });

  it.each([
    ["/themes", "cssthema themes"],
    ["/palettes", "cssthema palettes"],
    ["/editor/abc123", "cssthema edit abc123"],
    ["/bestaat-niet", "cssthema bestaat-niet"],
  ])("commando voor %s is %s", (path, command) => {
    renderApp(path);
    expect(terminalCommand()).toBe(command);
  });

  it("heeft vijf navigatieknoppen (Nederlands) en markeert de actieve", () => {
    renderApp("/themes");
    const links = navLinks();
    expect(links.map((a) => a.textContent)).toEqual([
      "📊Dashboard",
      "🎨Thema's",
      "🖌️Paletten",
      "🌐Hosts",
      "📥Import",
    ]);
    // De emoji is decoratief: de toegankelijke naam is alleen het label.
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/themes",
      "/palettes",
      "/hosts",
      "/import",
    ]);
    const active = links.filter((a) => a.getAttribute("aria-current") === "page");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveAccessibleName("Thema's");
  });

  it("markeert Thema's ook in de editor en Dashboard alleen op /", () => {
    renderApp("/editor/xyz");
    const active = navLinks().filter((a) => a.getAttribute("aria-current") === "page");
    expect(active.map((a) => a.getAttribute("href"))).toEqual(["/themes"]);
  });

  it("navigeert via de knoppen en zet de venstertitel", async () => {
    renderApp("/");
    expect(document.title).toBe("Dashboard · cssthema");
    fireEvent.click(screen.getByRole("link", { name: "Paletten" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Paletten" })).toBeInTheDocument();
    expect(document.title).toBe("Paletten · cssthema");
    expect(terminalCommand()).toBe("cssthema palettes");
  });

  it("houdt routes van latere fases bereikbaar maar buiten de navigatie", () => {
    renderApp("/settings");
    expect(screen.getByRole("heading", { level: 1, name: "Instellingen" })).toBeInTheDocument();
    expect(screen.getByText("Dit scherm komt in een volgende versie.")).toBeInTheDocument();
    expect(navLinks().map((a) => a.getAttribute("href"))).not.toContain("/settings");
  });

  it("toont de systeemstatus uit /readyz", async () => {
    stubHealth(503);
    renderApp("/themes");
    const status = document.querySelector("[data-state]");
    expect(status).toHaveTextContent("controleren…");
    expect(await screen.findByTitle("Systeemstatus (/readyz): fout")).toHaveAttribute(
      "data-state",
      "error",
    );
  });

  it("toont ● ok als /readyz antwoordt", async () => {
    renderApp("/themes");
    expect(await screen.findByTitle("Systeemstatus (/readyz): ok")).toHaveTextContent("ok");
  });

  it("toont de health-rijen op het dashboard", async () => {
    stubHealth(503);
    renderApp("/");
    const row = (path: string) => document.querySelector(`[data-health="${path}"]`) as HTMLElement;
    expect(await within(row("/healthz")).findByText("ok")).toBeInTheDocument();
    expect(await within(row("/readyz")).findByText("fout")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
  });

  it("schakelt de achtergrond uit en bewaart dat", () => {
    renderApp("/");
    const canvas = document.getElementById("bg");
    expect(canvas).toHaveAttribute("data-mode", "running");
    const toggle = screen.getByRole("button", { name: "achtergrond" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(canvas).toHaveAttribute("data-mode", "off");
    expect(localStorage.getItem("cssthema.background")).toBe("off");
    fireEvent.click(toggle);
    expect(canvas).toHaveAttribute("data-mode", "running");
    expect(localStorage.getItem("cssthema.background")).toBe("on");
  });

  it("pauzeert de achtergrond en verbreedt de kaart op de editorroute", () => {
    renderApp("/editor/abc");
    expect(document.getElementById("bg")).toHaveAttribute("data-mode", "paused");
    expect(document.getElementById("app-wrap")).toHaveAttribute("data-wide", "true");
  });

  it("zet de achtergrond uit bij prefers-reduced-motion", () => {
    setReducedMotion(true);
    renderApp("/");
    expect(document.getElementById("bg")).toHaveAttribute("data-mode", "off");
    const toggle = screen.getByRole("button", { name: "achtergrond" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", "Uit: je systeem vraagt om minder beweging");
  });

  it("reageert live op een wijziging van reduced motion", () => {
    renderApp("/");
    expect(document.getElementById("bg")).toHaveAttribute("data-mode", "running");
    act(() => setReducedMotion(true));
    expect(document.getElementById("bg")).toHaveAttribute("data-mode", "off");
  });

  it("toont een 404-pagina met terminal voor onbekende routes", () => {
    renderApp("/bestaat-niet");
    expect(
      screen.getByRole("heading", { level: 1, name: "Pagina niet gevonden" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("/bestaat-niet: pagina niet gevonden");
    expect(screen.getByRole("link", { name: "Terug naar het dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("heeft een skiplink die de focus naar de inhoud zet", () => {
    renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: "Naar de inhoud" }));
    expect(document.activeElement).toBe(document.getElementById("main"));
  });

  it("laat een pagina het terminalcommando overschrijven zolang ze gemount is", () => {
    function Page() {
      useShellCommand("cssthema edit proxmox");
      return <p>pagina</p>;
    }
    const router = createMemoryRouter([{ path: "/", element: <Page /> }]);
    const { unmount } = render(<RouterProvider router={router} />);
    expect(useUiStore.getState().commandOverride).toBe("cssthema edit proxmox");
    unmount();
    expect(useUiStore.getState().commandOverride).toBeNull();
  });
});

describe("Taal", () => {
  beforeEach(() => stubHealth());

  it("start in het Nederlands en wisselt naar het Engels", () => {
    render(<App />);
    expect(document.documentElement.lang).toBe("nl");
    const main = document.getElementById("main");
    const toggle = screen.getByRole("button", { name: "Switch to English" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.documentElement.lang).toBe("en");
    // Geen remount van de routerboom: zelfde elementen, de focus blijft op de knop.
    expect(document.getElementById("main")).toBe(main);
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Themes" })).toBeInTheDocument();
    expect(localStorage.getItem("cssthema.locale")).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "Schakel naar Nederlands" }));
    expect(screen.getByRole("link", { name: "Thema's" })).toBeInTheDocument();
  });

  it("remount niets: focus, ingevulde velden en de DOM blijven staan", () => {
    function FormPage() {
      const { t } = useI18n();
      return <input aria-label="zoekterm" placeholder={t("nav.themes")} />;
    }
    const router = createMemoryRouter([
      { path: "/", element: <AppShell />, children: [{ index: true, element: <FormPage /> }] },
    ]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("textbox", { name: "zoekterm" });
    fireEvent.change(input, { target: { value: "getypte tekst" } });
    const main = document.getElementById("main");
    const toggle = screen.getByRole("button", { name: "Switch to English" });
    toggle.focus();
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Schakel naar Nederlands" })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(document.getElementById("main")).toBe(main);
    expect(screen.getByRole("textbox", { name: "zoekterm" })).toBe(input);
    expect(input).toHaveValue("getypte tekst");
    expect(input).toHaveAttribute("placeholder", "Themes");
    expect(screen.getByRole("link", { name: "Themes" })).toBeInTheDocument();
  });
});

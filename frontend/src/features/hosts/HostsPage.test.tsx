import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, noContent, problem } from "@/api/testing/fetch-mock";
import {
  makeHost,
  makeHostCheck,
  makeHostHealth,
  makeHostHealthOverview,
  makeHostOptions,
  testId,
} from "@/api/testing/fixtures";
import type { HostBinding, HostHealthOverview } from "@/api/types";
import { createServer, renderPage, toastTexts } from "@/features/themes/testing";
import { HostsPage } from "./HostsPage";

const fallback = makeHost({
  id: testId(1),
  hostname: "*",
  styles: ["algemeen"],
  scripts: ["algemeen"],
});
const proxmox = makeHost({
  id: testId(2),
  hostname: "proxmox.example",
  styles: ["algemeen", "alg-proxmox"],
  scripts: [],
  note: "Hypervisor",
});
const vault = makeHost({
  id: testId(3),
  hostname: "vault.example",
  styles: ["nord"],
  scripts: [],
  enabled: false,
});

function server(
  hosts: HostBinding[] = [fallback, proxmox, vault],
  health: HostHealthOverview = makeHostHealthOverview(),
) {
  return createServer()
    .on("GET", "/api/v1/hosts", () => json(hosts))
    .on("GET", "/api/v1/hosts/options", () => json(makeHostOptions()))
    .on("GET", "/api/v1/hosts/health", () => json(health));
}

/** ISO-tijd zoveel minuten geleden. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function rows() {
  const table = screen.getByRole("table", { name: "Host-koppelingen" });
  return within(table).getAllByRole("row").slice(1);
}

describe("HostsPage", () => {
  it("toont de regel voor NPM en de koppelingen, met * als Standaard", async () => {
    renderPage(<HostsPage />, { path: "/hosts", server: server() });
    expect(await screen.findByRole("table", { name: "Host-koppelingen" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Hosts" })).toBeInTheDocument();
    expect(document.querySelector("[data-snippet-code]")).toHaveTextContent("/host/$host.css");
    expect(document.querySelector("[data-snippet-own-domain]")).toHaveTextContent("/alg-thema/");

    const [first, second, third] = rows();
    expect(within(first!).getByText("Standaard (*)")).toBeInTheDocument();
    // Thema's genummerd in laadvolgorde, scripts leeg → "geen script".
    expect(
      within(second!)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["1.algemeen", "2.alg-proxmox"]);
    expect(within(second!).getByText("geen script")).toBeInTheDocument();
    expect(within(second!).getByText("Hypervisor")).toBeInTheDocument();
    expect(
      within(second!).getByRole("link", { name: "CSS van proxmox.example openen" }),
    ).toHaveAttribute("href", proxmox.css_url);
    expect(within(third!).getByRole("switch", { name: "vault.example aan" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("3 hosts")).toBeInTheDocument();
    expect(screen.queryByText("Geen standaard ingesteld")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Hosts zoeken" }), {
      target: { value: "VAULT" },
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("1 van 3")).toBeInTheDocument();
  });

  it("maakt een host aan met thema's in de gekozen volgorde", async () => {
    const api = server().on("POST", "/api/v1/hosts", ({ body }) =>
      json(makeHost({ id: testId(9), ...(body as Partial<HostBinding>) }), { status: 201 }),
    );
    renderPage(<HostsPage />, { path: "/hosts", server: api });
    await screen.findByRole("table", { name: "Host-koppelingen" });

    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe host" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Nieuwe host" }));
    fireEvent.change(dialog.getByLabelText("Hostnaam"), { target: { value: "nas.example" } });

    const styles = dialog.getByLabelText("Thema's");
    fireEvent.change(styles, { target: { value: "algemeen" } });
    fireEvent.click(dialog.getByRole("button", { name: "Thema toevoegen" }));
    // Enter voegt ook toe, en een vrije naam mag.
    fireEvent.change(styles, { target: { value: "eigen-css" } });
    fireEvent.keyDown(styles, { key: "Enter" });
    expect(dialog.getByText("onbekend")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "eigen-css omhoog" }));

    fireEvent.change(dialog.getByLabelText("Scripts"), { target: { value: "extra" } });
    fireEvent.click(dialog.getByRole("button", { name: "Script toevoegen" }));
    fireEvent.change(dialog.getByLabelText("Notitie"), { target: { value: " NAS " } });
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));

    await waitFor(() => expect(api.callsTo("POST", "/api/v1/hosts")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/v1/hosts")[0]?.body).toEqual({
      hostname: "nas.example",
      styles: ["eigen-css", "algemeen"],
      scripts: ["extra"],
      enabled: true,
      note: "NAS",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toastTexts()).toContainEqual({ tone: "ok", text: "nas.example toegevoegd." });
  });

  it("toont een conflict bij de hostnaam", async () => {
    const api = server().on("POST", "/api/v1/hosts", () =>
      problem(409, "host_conflict", { detail: "proxmox.example heeft al een koppeling." }),
    );
    renderPage(<HostsPage />, { path: "/hosts", server: api });
    await screen.findByRole("table", { name: "Host-koppelingen" });
    fireEvent.click(screen.getByRole("button", { name: "+ Nieuwe host" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Nieuwe host" }));
    fireEvent.change(dialog.getByLabelText("Hostnaam"), { target: { value: "proxmox.example" } });
    fireEvent.click(dialog.getByRole("button", { name: "Aanmaken" }));
    expect(await dialog.findByText("proxmox.example heeft al een koppeling.")).toBeInTheDocument();
    expect(dialog.getByLabelText("Hostnaam")).toHaveAttribute("aria-invalid", "true");
  });

  it("zet een host aan of uit met dezelfde gegevens", async () => {
    const api = server().on("PUT", "/api/v1/hosts/:id", ({ body }) =>
      json({ ...vault, ...(body as Partial<HostBinding>) }),
    );
    renderPage(<HostsPage />, { path: "/hosts", server: api });
    await screen.findByRole("table", { name: "Host-koppelingen" });
    fireEvent.click(screen.getByRole("switch", { name: "vault.example aan" }));

    await waitFor(() => expect(api.callsTo("PUT")).toHaveLength(1));
    const [call] = api.callsTo("PUT");
    expect(call?.path).toBe(`/api/v1/hosts/${vault.id}`);
    expect(call?.body).toEqual({
      hostname: "vault.example",
      styles: ["nord"],
      scripts: [],
      enabled: true,
      note: null,
    });
    await waitFor(() =>
      expect(toastTexts()).toContainEqual({ tone: "ok", text: "vault.example staat aan." }),
    );
  });

  it("verwijdert na bevestiging", async () => {
    const api = server().on("DELETE", "/api/v1/hosts/:id", () => noContent());
    renderPage(<HostsPage />, { path: "/hosts", server: api });
    await screen.findByRole("table", { name: "Host-koppelingen" });
    fireEvent.click(screen.getByRole("button", { name: "proxmox.example verwijderen" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Koppeling van proxmox.example verwijderen?" }),
    );
    expect(dialog.getByText("proxmox.example volgt daarna de standaard (*).")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "⚡ Verwijderen" }));
    await waitFor(() => expect(api.callsTo("DELETE")).toHaveLength(1));
    expect(api.callsTo("DELETE")[0]?.path).toBe(`/api/v1/hosts/${proxmox.id}`);
  });

  it("biedt Standaard instellen aan als * ontbreekt", async () => {
    renderPage(<HostsPage />, { path: "/hosts", server: server([proxmox]) });
    expect(await screen.findByText("Geen standaard ingesteld")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Standaard instellen" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Nieuwe host" }));
    expect(dialog.getByLabelText("Hostnaam")).toHaveValue("*");
  });

  it("importeert een NPM-config en toont het resultaat", async () => {
    const api = server().on("POST", "/api/v1/hosts/import", () =>
      json({
        created: ["nas.example", "git.example"],
        updated: ["proxmox.example"],
        unchanged: [],
        skipped: [{ line: 7, reason: "Geen hostnaam boven deze sub_filter." }],
      }),
    );
    renderPage(<HostsPage />, { path: "/hosts", server: api });
    await screen.findByRole("table", { name: "Host-koppelingen" });
    fireEvent.click(screen.getByRole("button", { name: "Importeren uit NPM-config" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Importeren uit NPM-config" }));

    // Leeg: eerst plakken.
    fireEvent.click(dialog.getByRole("button", { name: "Importeren" }));
    expect(await dialog.findByText("Plak eerst de config.")).toBeInTheDocument();

    const text = "# nas.example\nsub_filter '</head>' '…</head>';\n";
    fireEvent.change(dialog.getByLabelText("NPM-config"), { target: { value: text } });
    fireEvent.click(dialog.getByRole("checkbox", { name: "Bestaande overschrijven" }));
    fireEvent.click(dialog.getByRole("button", { name: "Importeren" }));

    const result = within(await screen.findByRole("dialog", { name: "Import klaar" }));
    expect(api.callsTo("POST", "/api/v1/hosts/import")[0]?.body).toEqual({ text, replace: false });
    expect(result.getByRole("status")).toHaveTextContent(
      "2 nieuw · 1 aangepast · 0 ongewijzigd · 1 regel overgeslagen",
    );
    expect(result.getByText("Regel 7: Geen hostnaam boven deze sub_filter.")).toBeInTheDocument();
    expect(result.getByText("nas.example")).toBeInTheDocument();
    // Na een import wordt de lijst opnieuw opgehaald.
    await waitFor(() => expect(api.callsTo("GET", "/api/v1/hosts").length).toBeGreaterThan(1));
  });

  describe("gezondheid", () => {
    const health = makeHostHealthOverview({
      check_finished_at: minutesAgo(10),
      hosts: [
        makeHostHealth({ hostname: "*", level: "ok", last_seen: minutesAgo(5) }),
        makeHostHealth({
          hostname: "proxmox.example",
          level: "error",
          missing_styles: ["alg-proxmox"],
          missing_scripts: ["extra"],
          check: makeHostCheck({
            level: "error",
            code: "csp_blocked",
            detail: "De CSP van de app laat css.example niet toe.",
            checked_at: minutesAgo(10),
          }),
        }),
        makeHostHealth({
          hostname: "vault.example",
          enabled: false,
          level: "ok",
          check: makeHostCheck(),
        }),
      ],
    });

    it("toont per koppeling een status met uitleg, ontbrekende delen en laatst geladen", async () => {
      renderPage(<HostsPage />, { path: "/hosts", server: server(undefined, health) });
      await screen.findByRole("table", { name: "Host-koppelingen" });
      const [first, second, third] = rows();

      await waitFor(() => expect(within(first!).getByText("In orde")).toBeInTheDocument());
      expect(first!.querySelector("[data-level]")).toHaveAttribute("data-level", "ok");
      expect(within(first!).getByText(/^Laatst geladen: 5 min/)).toBeInTheDocument();

      expect(within(second!).getByText("CSP blokkeert")).toBeInTheDocument();
      expect(second!.querySelector("[data-level]")).toHaveAttribute("data-level", "error");
      expect(
        within(second!).getByText("De CSP van de app laat css.example niet toe."),
      ).toBeInTheDocument();
      expect(within(second!).getByText("Ontbreekt: alg-proxmox, extra.js")).toBeInTheDocument();
      expect(within(second!).getByText("Nog niet geladen")).toBeInTheDocument();

      // Uitgeschakelde koppeling: "Uit", grijs.
      expect(within(third!).getByText("Uit")).toBeInTheDocument();
      expect(third!.querySelector("[data-level]")).toHaveAttribute("data-level", "off");

      expect(screen.getByText(/^Laatste controle: 10 min/)).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Geladen zonder eigen koppeling" }),
      ).not.toBeInTheDocument();
    });

    it("start een controle en pollt tot ze klaar is", { timeout: 10_000 }, async () => {
      let phase: "idle" | "running" | "done" = "idle";
      const api = server()
        .on("GET", "/api/v1/hosts/health", () => {
          if (phase === "idle") return json(makeHostHealthOverview());
          if (phase === "running") {
            phase = "done"; // de volgende poll is klaar
            return json(makeHostHealthOverview({ check_running: true }));
          }
          return json(makeHostHealthOverview({ check_finished_at: minutesAgo(0) }));
        })
        .on("POST", "/api/v1/hosts/check", () => {
          phase = "running";
          return json({ started: true }, { status: 202 });
        });
      renderPage(<HostsPage />, { path: "/hosts", server: api });
      expect(await screen.findByText("Nog niet gecontroleerd")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Alles controleren" }));
      const busy = await screen.findByRole("button", { name: "Controleren…" });
      expect(busy).toBeDisabled();
      expect(api.callsTo("POST", "/api/v1/hosts/check")).toHaveLength(1);
      await waitFor(() =>
        expect(toastTexts()).toContainEqual({ tone: "ok", text: "Controle gestart." }),
      );

      expect(
        await screen.findByRole("button", { name: "Alles controleren" }, { timeout: 5000 }),
      ).toBeEnabled();
      expect(screen.getByText(/^Laatste controle:/)).toBeInTheDocument();
    });

    it("toont hosts zonder eigen koppeling, met koppelen en vergeten", async () => {
      const seen = makeHostHealthOverview({
        hosts: [
          makeHostHealth({ hostname: "*", level: "ok" }),
          makeHostHealth({ hostname: "git.example", bound: false, last_seen: minutesAgo(3) }),
        ],
      });
      let forgotten = false;
      const api = server(undefined, seen)
        .on("GET", "/api/v1/hosts/health", () =>
          json(forgotten ? { ...seen, hosts: seen.hosts.slice(0, 1) } : seen),
        )
        .on("DELETE", "/api/v1/hosts/seen/:hostname", () => {
          forgotten = true;
          return noContent();
        });
      renderPage(<HostsPage />, { path: "/hosts", server: api });

      const section = within(
        (await screen.findByRole("heading", { name: "Geladen zonder eigen koppeling" }))
          .parentElement!,
      );
      expect(section.getByText("git.example")).toBeInTheDocument();
      expect(section.getByText(/^Laatst geladen: 3 min/)).toBeInTheDocument();

      // Koppeling maken: de dialoog met de hostnaam en wat * nu geeft.
      fireEvent.click(section.getByRole("button", { name: "Koppeling maken voor git.example" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Nieuwe host" }));
      expect(dialog.getByLabelText("Hostnaam")).toHaveValue("git.example");
      fireEvent.click(dialog.getByRole("button", { name: "Annuleren" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      fireEvent.click(section.getByRole("button", { name: "git.example vergeten" }));
      await waitFor(() => expect(api.callsTo("DELETE")).toHaveLength(1));
      expect(api.callsTo("DELETE")[0]?.path).toBe("/api/v1/hosts/seen/git.example");
      await waitFor(() =>
        expect(
          screen.queryByRole("heading", { name: "Geladen zonder eigen koppeling" }),
        ).not.toBeInTheDocument(),
      );
      expect(toastTexts()).toContainEqual({ tone: "ok", text: "git.example vergeten." });
    });
  });
});

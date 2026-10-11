import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { json, noContent, problem } from "@/api/testing/fetch-mock";
import { makeHost, makeHostOptions, testId } from "@/api/testing/fixtures";
import type { HostBinding } from "@/api/types";
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

function server(hosts: HostBinding[] = [fallback, proxmox, vault]) {
  return createServer()
    .on("GET", "/api/v1/hosts", () => json(hosts))
    .on("GET", "/api/v1/hosts/options", () => json(makeHostOptions()));
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
});

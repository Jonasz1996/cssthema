import { useRef, useState } from "react";
import {
  Button,
  Callout,
  Category,
  Checkbox,
  Code,
  ConfirmDialog,
  Details,
  Dialog,
  Empty,
  Field,
  Input,
  ItemRow,
  Kpi,
  KpiGrid,
  Label,
  Loading,
  PageHeader,
  Pre,
  Select,
  Table,
  TabPanel,
  Tabs,
  Tag,
  Terminal,
  Textarea,
  toast,
} from "@/components/ui";
import { fx } from "@/lib/fx";

/**
 * Ontwikkelpagina (alleen `pnpm dev`, route `/dev/ui`): alle UI-componenten en effecten op één
 * plek, om de stijl te controleren en als voorbeeld bij het bouwen van nieuwe schermen.
 * Teksten staan hier bewust niet in i18n.
 */

interface DemoRow {
  slug: string;
  version: number | null;
  size: string;
}

const rows: DemoRow[] = [
  { slug: "proxmox", version: 7, size: "3,4 KB" },
  { slug: "nextcloud", version: 12, size: "8,1 KB" },
  { slug: "grafana", version: null, size: "" },
];

type DemoTab = "overview" | "alerts" | "cti";

export function StyleguidePage() {
  const [tab, setTab] = useState<DemoTab>("overview");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [items, setItems] = useState(["proxmox-nord", "grafana-dark", "jellyfin-test"]);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const remove = async (name: string) => {
    const el = rowRefs.current.get(name);
    if (el) await fx.remove(el);
    setItems((current) => current.filter((item) => item !== name));
    toast.ok(`${name} verwijderd`);
  };

  return (
    <section>
      <PageHeader
        title="UI-componenten"
        hint="Stijlgids in de stijl van aiverslag (alleen in de dev-server)."
        actions={
          <>
            <Button onClick={(e) => fx.publish(e.currentTarget)}>Publiceren</Button>
            <Button variant="alt" onClick={(e) => fx.rollback(e.currentTarget)}>
              ↺ Rollback
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Clear all
            </Button>
            <Button variant="alt" onClick={() => setDialogOpen(true)}>
              💬 Dialoog
            </Button>
            <Button variant="alt" disabled>
              Uitgeschakeld
            </Button>
          </>
        }
      />

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <Input placeholder="Filter op naam of slug…" className="max-w-md min-w-[180px] flex-1" />
        <Checkbox label="alleen live" />
        <Checkbox label="alleen gewijzigd" defaultChecked />
      </div>

      <Callout title="Samenvatting">
        3 thema's live, 1 draft gewijzigd.{"\n"}Laatste publicatie: proxmox v7, vandaag 11:58.
      </Callout>

      <Category title="Thema's" count={items.length} meta="lokale demo · klik ✕ voor bliksem">
        {items.map((name, index) => (
          <ItemRow
            key={name}
            ref={(el) => {
              if (el) rowRefs.current.set(name, el);
              else rowRefs.current.delete(name);
            }}
            severity={index === 0 ? "ok" : index === 1 ? "mid" : "err"}
            label={index === 0 ? "live" : index === 1 ? "draft" : "fout"}
            title={name}
            tags={
              <>
                <Tag tone={index === 0 ? "ok" : "default"}>v{7 - index} live</Tag>
                {index === 1 && <Tag tone="mid">draft gewijzigd</Tag>}
                {index === 2 && <Tag tone="warn">actie nodig</Tag>}
                <Tag tone="err">voorbeeld fout</Tag>
              </>
            }
            meta="gewijzigd 2 min geleden · 3,4 KB"
            actions={
              <>
                <Button variant="mini">✎ Openen</Button>
                <Button variant="mini" tone="ok" onClick={(e) => fx.publish(e.currentTarget)}>
                  ✓ Publiceren
                </Button>
                <Button
                  variant="mini"
                  tone="danger"
                  aria-label={`${name} verwijderen`}
                  onClick={() => void remove(name)}
                >
                  ✕
                </Button>
              </>
            }
          >
            Sidebar donkerder, login-knop accent.
          </ItemRow>
        ))}
        {!items.length && <Empty>Geen items.</Empty>}
        <Details summary="Toon alle 12">
          <Empty>Nog 9 thema's…</Empty>
        </Details>
      </Category>

      <Category title="KPI's en tabel" defaultOpen>
        <KpiGrid>
          <Kpi label="Thema's" value={41} sub="29 gepubliceerd" />
          <Kpi label="Live" value={29} tone="ok" />
          <Kpi label="Draft gewijzigd" value={3} tone="mid" />
          <Kpi label="Fouten" value={1} tone="bad" sub="lint bij publiceren" />
        </KpiGrid>
        <Tabs
          id="styleguide-tabs"
          label="Demo-tabs"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "overview", label: "Overzicht" },
            { value: "alerts", label: "Alerts & bans" },
            { value: "cti", label: "CTI" },
          ]}
        />
        <TabPanel id="styleguide-tabs" value="overview" selected={tab}>
          <Table
            caption="Versies"
            rowKey={(row) => row.slug}
            columns={[
              { key: "slug", header: "Slug", cell: (row) => <Code>{row.slug}</Code> },
              {
                key: "version",
                header: "Live",
                cell: (row) => (row.version ? <Tag tone="ok">v{row.version}</Tag> : null),
              },
              { key: "size", header: "Grootte", cell: (row) => row.size },
            ]}
            rows={rows}
          />
        </TabPanel>
        <TabPanel id="styleguide-tabs" value="alerts" selected={tab}>
          <Table
            caption="Leeg"
            rowKey={(_, i) => i}
            columns={[{ key: "a", header: "A", cell: () => "" }]}
            rows={[]}
          />
        </TabPanel>
        <TabPanel id="styleguide-tabs" value="cti" selected={tab}>
          <Loading label="Laden…" />
        </TabPanel>
      </Category>

      <Category title="Formulier en code" defaultOpen>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Naam" hint="Slug-voorstel: proxmox-nord">
            <Input defaultValue="Proxmox Nord" />
          </Field>
          <Field label="Slug" error="Deze slug is al in gebruik.">
            <Input defaultValue="proxmox" />
          </Field>
          <Field label="Palet">
            <Select defaultValue="nord">
              <option value="terminal">terminal</option>
              <option value="nord">nord</option>
              <option value="dracula">dracula</option>
            </Select>
          </Field>
          <Field label="Bericht">
            <Textarea placeholder="Wat is er veranderd?" rows={3} />
          </Field>
        </div>
        <Label>Gecompileerd</Label>
        <Pre>{`/*! cssthema · proxmox · v7 · 2026-10-05T11:58Z · sha256:3f9a1c0e2b7d */\n:root{--ct-bg:#2e3440;--ct-fg:#eceff4}`}</Pre>
        <Label>Shell</Label>
        <Terminal
          lines={[
            { kind: "cmd", text: "root@jbogaert:~# cssthema import proxmox.css" },
            { kind: "dim", text: "verbinden met de api..." },
            { text: "proxmox: v1 gepubliceerd" },
            { kind: "ok", text: "# klaar" },
            { kind: "err", text: "grafana.css: slug bestaat al" },
          ]}
        />
        <div className="mt-3.5 flex flex-wrap gap-2.5">
          <Button variant="alt" onClick={() => toast("Draft opgeslagen")}>
            Toast
          </Button>
          <Button variant="alt" onClick={() => toast.ok("proxmox v8 is live")}>
            Toast ok
          </Button>
          <Button variant="alt" onClick={() => toast.err("Publiceren mislukt: lint-fouten")}>
            Toast fout
          </Button>
          <Button
            variant="alt"
            onClick={() => toast.mid("Conflict: iemand anders bewerkte dit thema")}
          >
            Toast midden
          </Button>
        </div>
      </Category>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        command="cssthema publish proxmox"
        title="Publiceer proxmox"
        description="Nieuwe versie v8 · +14 −3 regels t.o.v. v7"
        footer={
          <>
            <Button
              onClick={(e) => {
                fx.publish(e.currentTarget);
                setDialogOpen(false);
              }}
            >
              ⚡ Publiceer v8
            </Button>
            <Button variant="alt" onClick={() => setDialogOpen(false)}>
              Annuleren
            </Button>
          </>
        }
      >
        <Field label="Bericht (optioneel)">
          <Input placeholder="Sidebar donkerder, login-knop accent" />
        </Field>
        <Label>Live op</Label>
        <Pre>https://css.jbogaert.be/proxmox.css</Pre>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Alles wissen?"
        command="cssthema clear --all"
        tone="danger"
        confirmLabel="💣 Wissen"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          fx.explode(window.innerWidth / 2, window.innerHeight / 3, 1.6);
          fx.flash("radial-gradient(circle at 50% 40%,rgba(255,150,40,.55),transparent 70%)");
          fx.shake();
        }}
      >
        Dit is een demo: er wordt niets gewist.
      </ConfirmDialog>
    </section>
  );
}

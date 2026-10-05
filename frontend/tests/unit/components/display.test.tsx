import { fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Callout,
  Card,
  Category,
  Checkbox,
  Code,
  Details,
  Field,
  Hint,
  Input,
  ItemRow,
  Kpi,
  KpiGrid,
  PageHeader,
  Pre,
  Select,
  Table,
  TabPanel,
  Tabs,
  Tag,
  Terminal,
  TerminalBar,
  Textarea,
} from "@/components/ui";
import { mockAnimationFrames, setReducedMotion } from "../../helpers";

describe("Card en TerminalBar", () => {
  it("toont drie bolletjes en prompt + commando", () => {
    render(
      <Card>
        <TerminalBar command="cssthema themes" />
      </Card>,
    );
    expect(screen.getByText("root@jbogaert:~# cssthema themes")).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-card i")).toHaveLength(3);
  });

  it("kantelt mee met de muis als tilt aan staat, niet bij reduced motion", () => {
    const frames = mockAnimationFrames();
    const ref = createRef<HTMLElement>();
    const { unmount } = render(<Card ref={ref} tilt />);
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 0, clientY: 0, pointerType: "mouse" }),
    );
    frames.flush();
    expect(ref.current?.style.transform).toContain("rotateY(");
    unmount();

    setReducedMotion(true);
    const ref2 = createRef<HTMLElement>();
    render(<Card ref={ref2} tilt />);
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), { clientX: 0, clientY: 0, pointerType: "mouse" }),
    );
    frames.flush();
    expect(ref2.current?.style.transform).toBe("");
  });

  it("PageHeader zet titel, hint met cursor en de venstertitel", () => {
    render(<PageHeader title="Thema's" hint="Al je thema's" actions={<button>Nieuw</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Thema's" })).toHaveClass("ui-shine");
    expect(screen.getByText("Al je thema's").querySelector(".ui-cursor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nieuw" })).toBeInTheDocument();
    expect(document.title).toBe("Thema's · cssthema");
  });

  it("Hint zonder cursor", () => {
    render(<Hint>Laden</Hint>);
    expect(screen.getByText("Laden").querySelector(".ui-cursor")).toBeNull();
  });
});

describe("Tag", () => {
  it.each([
    ["default", "text-muted"],
    ["ok", "text-ok"],
    ["warn", "border-err"],
    ["err", "bg-err/15"],
    ["mid", "text-mid"],
  ] as const)("toon %s", (tone, cls) => {
    render(<Tag tone={tone}>v7 live</Tag>);
    expect(screen.getByText("v7 live").className).toContain(cls);
  });
});

describe("Category en Details", () => {
  it("klapt open/dicht en bewaart de toestand per storageKey", () => {
    const { unmount } = render(
      <Category title="Thema's" count={3} meta="model x" storageKey="cat.themes">
        <p>inhoud</p>
      </Category>,
    );
    const details = screen.getByText("inhoud").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(within(details).getByText("(3)")).toBeInTheDocument();
    expect(within(details).getByText("model x")).toBeInTheDocument();
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem("cssthema.open") ?? "{}")).toEqual({
      "cat.themes": false,
    });
    unmount();

    render(
      <Category title="Thema's" storageKey="cat.themes">
        <p>inhoud</p>
      </Category>,
    );
    expect((screen.getByText("inhoud").closest("details") as HTMLDetailsElement).open).toBe(false);
  });

  it("werkt gecontroleerd met open + onOpenChange", () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <Details
          summary="Toon alle 12"
          open={open}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          rest
        </Details>
      );
    }
    render(<Controlled />);
    const details = screen.getByText("rest").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(details.open).toBe(true);
  });

  it("Details is standaard dicht", () => {
    render(<Details summary="meer">rest</Details>);
    expect((screen.getByText("rest").closest("details") as HTMLDetailsElement).open).toBe(false);
  });
});

describe("ItemRow", () => {
  it("toont label, titel, tags, toelichting, meta en acties met een kleur per ernst", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ItemRow
        ref={ref}
        severity="err"
        label="hoog"
        title="proxmox"
        tags={<Tag tone="warn">actie nodig</Tag>}
        meta="2 min geleden"
        actions={<button>✕</button>}
      >
        uitleg
      </ItemRow>,
    );
    expect(ref.current).toHaveClass("border-l-err");
    expect(screen.getByText("hoog")).toHaveClass("text-err");
    expect(screen.getByText("proxmox")).toBeInTheDocument();
    expect(screen.getByText("actie nodig")).toBeInTheDocument();
    expect(screen.getByText("uitleg")).toBeInTheDocument();
    expect(screen.getByText("2 min geleden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
  });
});

describe("Kpi", () => {
  it("is een definitielijst met label en waarde", () => {
    render(
      <KpiGrid>
        <Kpi label="Thema's" value={41} sub="29 live" />
        <Kpi label="Fouten" value={1} tone="bad" />
      </KpiGrid>,
    );
    expect(screen.getByText("Thema's").tagName).toBe("DT");
    expect(screen.getByText("41").closest("dd")).toBeInTheDocument();
    expect(screen.getByText("29 live")).toBeInTheDocument();
    expect(screen.getByText("1")).toHaveClass("text-err");
    expect(screen.getByText("Fouten").parentElement).toHaveClass("border-err");
  });
});

describe("Table", () => {
  const columns = [
    { key: "slug", header: "Slug", cell: (r: { slug: string; v: number | null }) => r.slug },
    { key: "v", header: "Versie", cell: (r: { slug: string; v: number | null }) => r.v },
  ];

  it("rendert koppen, rijen en '-' voor lege cellen", () => {
    render(
      <Table
        caption="Thema's"
        columns={columns}
        rows={[
          { slug: "proxmox", v: 7 },
          { slug: "grafana", v: null },
        ]}
        rowKey={(r) => r.slug}
      />,
    );
    const table = screen.getByRole("table", { name: "Thema's" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Slug", "Versie"]);
    const rows = within(table).getAllByRole("row");
    expect(rows[2]).toHaveTextContent("grafana-");
  });

  it("toont een lege toestand", () => {
    render(<Table columns={columns} rows={[]} rowKey={(r) => r.slug} />);
    expect(screen.getByText("Geen gegevens.")).toHaveAttribute("colspan", "2");
  });
});

describe("Tabs", () => {
  function Harness() {
    const [value, setValue] = useState<"a" | "b" | "c">("a");
    return (
      <>
        <Tabs
          id="t"
          label="Weergave"
          value={value}
          onValueChange={setValue}
          items={[
            { value: "a", label: "Overzicht" },
            { value: "b", label: "Alerts", disabled: true },
            { value: "c", label: "CTI" },
          ]}
        />
        <TabPanel id="t" value="a" selected={value}>
          paneel a
        </TabPanel>
        <TabPanel id="t" value="c" selected={value}>
          paneel c
        </TabPanel>
      </>
    );
  }

  it("koppelt tabs en panelen en wisselt met klik en pijltjes", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "Weergave" });
    const first = screen.getByRole("tab", { name: "Overzicht" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Overzicht");

    first.focus();
    fireEvent.keyDown(list, { key: "ArrowRight" }); // slaat de uitgeschakelde tab over
    const cti = screen.getByRole("tab", { name: "CTI" });
    expect(cti).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(cti);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("paneel c");

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "End" });
    expect(cti).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.click(cti);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("paneel c");
  });

  it("zet het paneel in de tabvolgorde met een zichtbaar focuskader", () => {
    render(<Harness />);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("tabindex", "0");
    // `outline-none` zou het globale `:focus-visible`-kader overschrijven (WCAG 2.4.7).
    expect(panel).not.toHaveClass("outline-none");
    expect(panel).toHaveClass("focus-visible:outline-2", "focus-visible:outline-white");
  });
});

describe("Formulier", () => {
  it("Field koppelt label, hint en fout aan het invoerveld", () => {
    render(
      <>
        <Field label="Slug" hint="kleine letters" error="al in gebruik">
          <Input />
        </Field>
        <Field label="Palet">
          <Select>
            <option>nord</option>
          </Select>
        </Field>
        <Field label="Bericht" id="msg">
          <Textarea />
        </Field>
      </>,
    );
    const slug = screen.getByLabelText("Slug");
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(slug).toHaveAccessibleDescription("kleine letters al in gebruik");
    expect(screen.getByRole("alert")).toHaveTextContent("al in gebruik");
    expect(screen.getByLabelText("Palet").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Bericht")).toHaveAttribute("id", "msg");
    expect(screen.getByLabelText("Bericht")).not.toHaveAttribute("aria-invalid");
  });

  it("Input buiten een Field blijft gewoon werken", () => {
    render(<Input aria-label="Filter" placeholder="Filter…" />);
    expect(screen.getByRole("textbox", { name: "Filter" })).not.toHaveAttribute("aria-describedby");
  });

  it("Checkbox is via het hele label aan te klikken", () => {
    const onChange = vi.fn();
    render(<Checkbox label="alleen live" onChange={onChange} />);
    fireEvent.click(screen.getByText("alleen live"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: "alleen live" })).toBeChecked();
  });
});

describe("Code en Terminal", () => {
  it("Pre en Code tonen tekst in codekleur", () => {
    render(
      <>
        <Pre>:root{"{}"}</Pre>
        <Code>--ct-bg</Code>
      </>,
    );
    expect(screen.getByText(":root{}")).toHaveClass("text-code");
    expect(screen.getByText("--ct-bg").tagName).toBe("CODE");
  });

  it("Terminal toont regels met kleur per soort en scrollt naar onder", () => {
    const { rerender } = render(
      <Terminal label="Uitvoer" lines={[{ kind: "cmd", text: "$ import" }, { text: "bezig" }]} />,
    );
    const log = screen.getByRole("log", { name: "Uitvoer" });
    expect(screen.getByText("$ import")).toHaveClass("text-white");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 500 });
    rerender(
      <Terminal
        label="Uitvoer"
        lines={[
          { kind: "cmd", text: "$ import" },
          { text: "bezig" },
          { kind: "ok", text: "# klaar" },
        ]}
      />,
    );
    expect(screen.getByText("# klaar")).toHaveClass("text-ok");
    expect(log.scrollTop).toBe(500);
  });
});

describe("Callout", () => {
  it("toont titel, tekst en acties", () => {
    render(
      <Callout tone="mid" title="3 bestanden gevonden" actions={<button>Importeren</button>}>
        handgemaakte CSS
      </Callout>,
    );
    expect(screen.getByText("3 bestanden gevonden")).toBeInTheDocument();
    expect(screen.getByText("handgemaakte CSS", { exact: false }).className).toContain(
      "border-mid/60",
    );
    expect(screen.getByRole("button", { name: "Importeren" })).toBeInTheDocument();
  });
});

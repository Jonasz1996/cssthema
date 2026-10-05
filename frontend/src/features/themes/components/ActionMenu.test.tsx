import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

function setup(overrides: Partial<ActionMenuItem>[] = []) {
  const onSelect = vi.fn();
  const base: ActionMenuItem[] = [
    { id: "open", label: "Openen", onSelect: () => onSelect("open") },
    {
      id: "export",
      label: "Exporteren",
      onSelect: () => onSelect("export"),
      disabled: true,
      hint: "Nog geen live versie",
    },
    { id: "delete", label: "Verwijderen", onSelect: () => onSelect("delete"), tone: "danger" },
  ];
  const items = base.map((item, index) => ({ ...item, ...overrides[index] }));
  render(
    <div>
      <ActionMenu label="Acties voor Proxmox" items={items} />
      <button type="button">elders</button>
    </div>,
  );
  const trigger = screen.getByRole("button", { name: "Acties voor Proxmox" });
  return { trigger, onSelect };
}

const menuitem = (name: string | RegExp) => screen.getByRole("menuitem", { name });

describe("ActionMenu", () => {
  it("is een menuknop die het menu opent met de focus op het eerste item", () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(menu).toHaveAccessibleName("Acties voor Proxmox");
    expect(menuitem("Openen")).toHaveFocus();
  });

  it("↓ opent op het eerste item, ↑ op het laatste", () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(menuitem("Verwijderen")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(menuitem("Openen")).toHaveFocus();
  });

  it("pijltjes, Home en End lopen rond door de items (ook uitgeschakelde)", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(menuitem(/Exporteren/)).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(menuitem("Openen")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(menuitem("Verwijderen")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(menuitem("Openen")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(menuitem("Verwijderen")).toHaveFocus();
  });

  it("Esc sluit en zet de focus terug op de knop", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("Tab en een klik erbuiten sluiten het menu", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("button", { name: "elders" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("een item kiezen sluit het menu, geeft de focus terug en voert de actie uit", () => {
    const { trigger, onSelect } = setup();
    fireEvent.click(trigger);
    fireEvent.click(menuitem("Verwijderen"));
    expect(onSelect).toHaveBeenCalledWith("delete");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("een uitgeschakeld item doet niets en legt uit waarom", () => {
    const { trigger, onSelect } = setup();
    fireEvent.click(trigger);
    const item = menuitem(/Exporteren/);
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAccessibleName("Exporteren (Nog geen live versie)");
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

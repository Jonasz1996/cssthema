import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, ConfirmDialog, Dialog, Input } from "@/components/ui";

function Harness({ dismissible = true, onClose }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Openen</Button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Publiceer proxmox"
        command="cssthema publish proxmox"
        description="Nieuwe versie v8"
        dismissible={dismissible}
        footer={<Button>Publiceer v8</Button>}
      >
        <Input aria-label="Bericht" />
      </Dialog>
    </>
  );
}

function openDialog() {
  const opener = screen.getByRole("button", { name: "Openen" });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole("dialog") };
}

describe("Dialog", () => {
  it("rendert niets als hij dicht is", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is een modale dialoog met titel, beschrijving en terminalbalk", () => {
    render(<Harness />);
    const { dialog } = openDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Publiceer proxmox");
    expect(dialog).toHaveAccessibleDescription("Nieuwe versie v8");
    expect(screen.getByText("root@jbogaert:~# cssthema publish proxmox")).toBeInTheDocument();
    // via een portal in <body>, buiten de app
    expect(dialog.closest("[data-dialog-overlay]")?.parentElement).toBe(document.body);
  });

  it("zet de focus in de dialoog en houdt hem daar met Tab en Shift+Tab", () => {
    render(<Harness />);
    const { dialog } = openDialog();
    const close = screen.getByRole("button", { name: "Sluiten" });
    const last = screen.getByRole("button", { name: "Publiceer v8" });
    expect(document.activeElement).toBe(close);

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("haalt de focus terug als die buiten de dialoog belandt", () => {
    render(<Harness />);
    const { opener } = openDialog();
    act(() => opener.focus());
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("sluit met Esc en geeft de focus terug aan de opener", () => {
    render(<Harness />);
    const { opener } = openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("sluit bij een klik op de overlay, niet bij een klik in de kaart", () => {
    render(<Harness />);
    const { dialog } = openDialog();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const overlay = dialog.closest("[data-dialog-overlay]") as HTMLElement;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sluit niet als een sleep in de kaart begint en op de overlay eindigt", () => {
    render(<Harness />);
    const { dialog } = openDialog();
    const overlay = dialog.closest("[data-dialog-overlay]") as HTMLElement;
    fireEvent.pointerDown(dialog);
    fireEvent.click(overlay);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("negeert Esc, overlay en sluitknop als hij niet sluitbaar is", () => {
    const onClose = vi.fn();
    render(<Harness dismissible={false} onClose={onClose} />);
    const { dialog } = openDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    const overlay = dialog.closest("[data-dialog-overlay]") as HTMLElement;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Sluiten" })).not.toBeInTheDocument();
  });

  it("vergrendelt scrollen en maakt #root inert zolang hij open is", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    try {
      render(<Harness />, { container: root });
      openDialog();
      expect(root).toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("hidden");
      fireEvent.keyDown(document, { key: "Escape" });
      expect(root).not.toHaveAttribute("inert");
      expect(document.body.style.overflow).toBe("");
    } finally {
      root.remove();
    }
  });

  it("sluit bij geneste dialogen met Esc alleen de bovenste", () => {
    function Nested() {
      const [inner, setInner] = useState(true);
      const [outer, setOuter] = useState(true);
      return (
        <>
          <Dialog open={outer} onClose={() => setOuter(false)} title="Buiten">
            buiten
          </Dialog>
          <Dialog open={inner} onClose={() => setInner(false)} title="Binnen">
            binnen
          </Dialog>
        </>
      );
    }
    render(<Nested />);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Buiten");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("zet de focus op annuleren en roept de juiste callbacks aan", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="proxmox verwijderen?"
        confirmLabel="Verwijderen"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        Het thema gaat naar de prullenbak.
      </ConfirmDialog>,
    );
    const cancel = screen.getByRole("button", { name: "Annuleren" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("schakelt de knoppen uit en blokkeert sluiten tijdens busy", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        title="Bezig"
        confirmLabel="OK"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuleren" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

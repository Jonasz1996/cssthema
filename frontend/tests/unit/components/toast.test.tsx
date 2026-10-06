import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MAX_TOASTS, toast, Toaster, useToastStore } from "@/components/ui";

describe("Toast", () => {
  it("toont meldingen in vaste live-regio's met de juiste toon", () => {
    render(<Toaster />);
    const region = screen.getByRole("region", { name: "Meldingen" });
    expect(region.parentElement).toBe(document.body);
    // De live-regio's bestaan al vóór de eerste melding (anders vaak niet voorgelezen).
    const polite = region.querySelector('[aria-live="polite"]') as HTMLElement;
    const assertive = region.querySelector('[aria-live="assertive"]') as HTMLElement;
    expect(polite).toBeEmptyDOMElement();
    expect(assertive).toBeEmptyDOMElement();

    act(() => {
      toast("Draft opgeslagen");
      toast.ok("proxmox v8 is live");
      toast.err("Publiceren mislukt");
    });
    expect(region.querySelector('[aria-live="polite"]')).toBe(polite);
    expect(polite).toHaveTextContent("Draft opgeslagen");
    expect(polite).toHaveTextContent("proxmox v8 is live");
    expect(assertive).toHaveTextContent("Publiceren mislukt");
    expect(assertive).not.toHaveTextContent("proxmox");
    // Geen geneste live-regio's per melding (dubbel voorlezen).
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("proxmox v8 is live").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "ok",
    );
  });

  it("sluit automatisch (fouten later) en via de sluitknop", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast("kort");
      toast.err("lang");
      toast.mid("blijft", { duration: 0 });
    });
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("kort")).not.toBeInTheDocument();
    expect(screen.getByText("lang")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText("lang")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("blijft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Melding sluiten" }));
    expect(screen.queryByText("blijft")).not.toBeInTheDocument();
  });

  it("pauzeert bij hover", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast("even lezen");
    });
    const item = screen.getByText("even lezen").closest("[data-tone]") as HTMLElement;
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText("even lezen")).toBeInTheDocument();
    fireEvent.pointerLeave(item);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("even lezen")).not.toBeInTheDocument();
  });

  it(`houdt hoogstens ${MAX_TOASTS} meldingen`, () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i++) toast(`melding ${i}`);
    const messages = useToastStore.getState().toasts.map((item) => item.message);
    expect(messages).toHaveLength(MAX_TOASTS);
    expect(messages[0]).toBe("melding 3");
  });

  it("toast.dismiss verwijdert op id", () => {
    const id = toast("weg");
    toast.dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

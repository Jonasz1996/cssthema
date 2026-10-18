import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "@/components/ui";
import { setReducedMotion } from "../../helpers";

const ripples = (el: HTMLElement) => el.querySelectorAll("[data-ripple]");

describe("Button", () => {
  it("rendert standaard een primary-knop met type=button", () => {
    render(<Button>Nu analyseren</Button>);
    const button = screen.getByRole("button", { name: "Nu analyseren" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("bg-btn");
  });

  it("toont een ripple op de klikpositie en ruimt die na 600 ms op", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Klik</Button>);
    const button = screen.getByRole("button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 100, y: 50, width: 200, height: 40 }),
    );
    fireEvent.click(button, { clientX: 150, clientY: 70, detail: 1 });
    expect(onClick).toHaveBeenCalledOnce();
    const [ripple] = ripples(button);
    expect(ripple).toBeDefined();
    expect(ripple).toHaveAttribute("aria-hidden", "true");
    // grootte = max(200, 40) / 4 = 50, gecentreerd op (50, 20) binnen de knop
    expect((ripple as HTMLElement).style.width).toBe("50px");
    expect((ripple as HTMLElement).style.left).toBe("25px");
    expect((ripple as HTMLElement).style.top).toBe("-5px");
    act(() => vi.advanceTimersByTime(600));
    expect(ripples(button)).toHaveLength(0);
  });

  it("start de ripple in het midden bij een toetsenbordklik", () => {
    render(<Button>Klik</Button>);
    const button = screen.getByRole("button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 80, height: 40 }),
    );
    fireEvent.click(button, { detail: 0 });
    const ripple = ripples(button)[0] as HTMLElement;
    expect(ripple.style.left).toBe(`${40 - 10}px`);
    expect(ripple.style.top).toBe(`${20 - 10}px`);
  });

  it("toont geen ripple bij prefers-reduced-motion, maar klikt wel", () => {
    setReducedMotion(true);
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Klik</Button>);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    expect(ripples(button)).toHaveLength(0);
  });

  it("geeft mini-knoppen en ripple={false} geen ripple", () => {
    render(
      <>
        <Button variant="mini">mini</Button>
        <Button variant="alt" ripple={false}>
          stil
        </Button>
        <Button variant="mini" ripple>
          mini met ripple
        </Button>
      </>,
    );
    for (const name of ["mini", "stil", "mini met ripple"])
      fireEvent.click(screen.getByRole("button", { name }));
    expect(ripples(screen.getByRole("button", { name: "mini" }))).toHaveLength(0);
    expect(ripples(screen.getByRole("button", { name: "stil" }))).toHaveLength(0);
    expect(ripples(screen.getByRole("button", { name: "mini met ripple" }))).toHaveLength(1);
  });

  it("roept onClick niet aan als de knop uitgeschakeld is", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Uit
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("past variant- en toonklassen toe", () => {
    render(
      <>
        <Button variant="danger">weg</Button>
        <Button variant="mini" tone="ok">
          ok
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "weg" }).className).toContain(
      "hover:not-disabled:bg-danger",
    );
    expect(screen.getByRole("button", { name: "ok" }).className).toContain(
      "hover:not-disabled:text-ok",
    );
  });
});

describe("ButtonLink", () => {
  it("is een link in knopstijl met aria-current als die actief is", () => {
    const router = createMemoryRouter([
      {
        path: "/",
        element: (
          <>
            <ButtonLink to="/themes" active>
              Thema's
            </ButtonLink>
            <ButtonLink to="/palettes">Paletten</ButtonLink>
          </>
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    const active = screen.getByRole("link", { name: "Thema's" });
    expect(active).toHaveAttribute("href", "/themes");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Paletten" })).not.toHaveAttribute("aria-current");
    fireEvent.click(active);
    expect(router.state.location.pathname).toBe("/themes");
  });
});

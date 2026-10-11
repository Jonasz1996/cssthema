import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "@/api/testing/fetch-mock";
import { createQueryWrapper } from "@/api/testing/query";
import type { DraftSession } from "../autosave/draft-session";
import { StatusBar } from "../components/StatusBar";
import { createByteCounter, SIZE_DEBOUNCE_FROM, sizeTone } from "../lib/css-size";

const SAVED = { kind: "saved", at: null } as const;

/** Minimale sessie: alleen wat de statusbalk leest. */
function fakeSession(initial: string) {
  let css = initial;
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => ({ css, state: SAVED }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    session: session as unknown as DraftSession,
    type: (next: string) => {
      css = next;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("css size", () => {
  it("warns above 90 % and errors above 100 % of the limit", () => {
    expect(sizeTone(900, 1000)).toBe("ok");
    expect(sizeTone(901, 1000)).toBe("mid");
    expect(sizeTone(1000, 1000)).toBe("mid");
    expect(sizeTone(1001, 1000)).toBe("err");
    expect(sizeTone(5000, undefined)).toBe("ok");
  });

  it("counts small texts at once and large texts only after a pause", () => {
    vi.useFakeTimers();
    const { session, type } = fakeSession("é");
    const counter = createByteCounter(session, { delayMs: 250 });
    const listener = vi.fn();
    counter.subscribe(listener);
    expect(counter.getBytes()).toBe(2);
    type("ab");
    expect(counter.getBytes()).toBe(2);
    type("abc");
    expect(counter.getBytes()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);

    const big = "x".repeat(SIZE_DEBOUNCE_FROM);
    type(big);
    type(big + "y");
    expect(counter.getBytes()).toBe(3);
    vi.advanceTimersByTime(249);
    expect(counter.getBytes()).toBe(3);
    vi.advanceTimersByTime(1);
    expect(counter.getBytes()).toBe(SIZE_DEBOUNCE_FROM + 1);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("StatusBar: size", () => {
  function renderBar(session: DraftSession, meta: Record<string, unknown> | null) {
    const server = createFetchMock();
    if (meta) server.on("GET", "/api/v1/meta", json(meta));
    vi.stubGlobal("fetch", server.fetch);
    return render(
      <StatusBar
        session={session}
        lint={undefined}
        lintPending={false}
        cursor={null}
        paletteName={null}
        problemsOpen={false}
        problemsId="problems"
        onToggleProblems={() => {}}
        onStatusAction={() => {}}
      />,
      { wrapper: createQueryWrapper() },
    );
  }

  const meta = (max: number) => ({
    name: "cssthema",
    version: "test",
    environment: "test",
    public_base_url: "https://css.example",
    css_max_bytes: max,
  });

  it("shows the size against the server limit and colours it near/over the limit", async () => {
    const { session, type } = fakeSession("x".repeat(2048));
    renderBar(session, meta(4096));
    const cell = await screen.findByText("2 KB / 4 KB");
    expect(cell).not.toHaveClass("text-mid");
    expect(cell).toHaveAttribute("title", "50 % van de maximale grootte (4 KB)");
    act(() => type("x".repeat(3800)));
    expect(screen.getByText(/ \/ 4 KB$/)).toHaveClass("text-mid");
    act(() => type("x".repeat(5000)));
    expect(screen.getByText(/ \/ 4 KB$/)).toHaveClass("text-err");
  });

  it("falls back to just the size while the limit is unknown", () => {
    const { session } = fakeSession("x".repeat(2048));
    renderBar(session, null);
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });
});

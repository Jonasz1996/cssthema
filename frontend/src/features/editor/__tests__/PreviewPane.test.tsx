import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchMock } from "@/api/testing/fetch-mock";
import { resetBridgeCache } from "../preview/bridge";
import { PreviewPane } from "../preview/PreviewPane";
import { DEFAULT_LAYOUT, useEditorStore, VIEWPORT_LIMITS } from "../store";
import BRIDGE from "../../../../public/preview-bridge.js?raw";

beforeEach(() => {
  resetBridgeCache();
  const server = createFetchMock().on(
    "GET",
    "/preview-bridge.js",
    () => new Response(BRIDGE, { status: 200 }),
  );
  vi.stubGlobal("fetch", server.fetch);
  useEditorStore.setState({
    layout: { ...DEFAULT_LAYOUT, viewport: "custom", customViewport: { width: 1024, height: 768 } },
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.setState({ tabs: [], layout: DEFAULT_LAYOUT });
});

describe("PreviewPane: eigen viewport", () => {
  it("shows the clamped value the preview really uses (Enter and blur)", () => {
    render(<PreviewPane session={undefined} paletteTokens={null} />);
    const width = screen.getByRole("spinbutton", { name: "Breedte in pixels" });
    const height = screen.getByRole("spinbutton", { name: "Hoogte in pixels" });

    fireEvent.change(width, { target: { value: "100" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);
    expect(useEditorStore.getState().layout.customViewport.width).toBe(VIEWPORT_LIMITS.min);

    fireEvent.change(height, { target: { value: "99999" } });
    fireEvent.blur(height);
    expect(height).toHaveValue(VIEWPORT_LIMITS.max);
    expect(useEditorStore.getState().layout.customViewport.height).toBe(VIEWPORT_LIMITS.max);

    // Nog eens te klein terwijl de opgeslagen waarde al het minimum is: het veld volgt toch.
    fireEvent.change(width, { target: { value: "50" } });
    fireEvent.blur(width);
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);

    // Ongeldige invoer: terug naar de huidige maat.
    fireEvent.change(width, { target: { value: "" } });
    fireEvent.blur(width);
    expect(width).toHaveValue(VIEWPORT_LIMITS.min);
  });
});

describe("PreviewPane: te grote CSS", () => {
  it("shows a notice and makes the frame visible when the bridge refuses the CSS", async () => {
    const { container } = render(<PreviewPane session={undefined} paletteTokens={null} />);
    const frame = await vi.waitFor(() => {
      const element = container.querySelector("iframe");
      if (!element?.contentWindow) throw new Error("nog geen iframe");
      return element;
    });
    expect(frame).toHaveAttribute("data-ready", "false");
    const fromFrame = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
      });

    fromFrame({ type: "cssthema:too-large", kind: "css", max: 2 * 1024 * 1024 });
    expect(screen.getByText("De CSS is te groot voor de live preview")).toBeInTheDocument();
    expect(screen.getByText(/neemt CSS tot 2 MB aan/)).toBeInTheDocument();
    expect(frame).toHaveAttribute("data-ready", "true");

    // Weer klein genoeg: de melding verdwijnt.
    fromFrame({ type: "cssthema:applied", seq: 1 });
    expect(screen.queryByText("De CSS is te groot voor de live preview")).toBeNull();
    expect(frame).toHaveAttribute("data-ready", "true");
  });
});

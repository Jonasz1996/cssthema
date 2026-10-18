import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Splitter, type SplitterProps } from "../components/Splitter";

function Harness(props: Partial<SplitterProps> & { initial?: number; onReset?: () => void }) {
  const [value, setValue] = useState(props.initial ?? 230);
  return (
    <Splitter
      orientation="vertical"
      value={value}
      min={160}
      max={420}
      step={16}
      fromDelta={(start, delta) => start + delta}
      onChange={setValue}
      label="Breedte van de verkenner"
      valueText={`${value} px`}
      {...props}
    />
  );
}

describe("Splitter (WAI-ARIA window splitter)", () => {
  it("is a focusable separator with its value", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "Breedte van de verkenner" });
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuenow", "230");
    expect(separator).toHaveAttribute("aria-valuemin", "160");
    expect(separator).toHaveAttribute("aria-valuemax", "420");
    expect(separator).toHaveAttribute("aria-valuetext", "230 px");
  });

  it("arrows move it, Shift moves faster, Home/End jump, values stay in range", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "246");
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(separator).toHaveAttribute("aria-valuenow", "182");
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(separator).toHaveAttribute("aria-valuenow", "160");
    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "420");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "160");
    // Pijlen loodrecht op de balk doen niets.
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "160");
  });

  it("reversed: the arrow towards the panel makes it bigger (preview on the right/bottom)", () => {
    render(
      <Harness
        orientation="horizontal"
        initial={0.42}
        min={0.2}
        max={0.8}
        step={0.02}
        reversed
        valueText="42 %"
      />,
    );
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowUp" });
    expect(separator).toHaveAttribute("aria-valuenow", "0.44");
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(separator).toHaveAttribute("aria-valuenow", "0.4");
  });

  it("Enter and double-click reset to the default", () => {
    const onReset = vi.fn();
    render(<Harness onReset={onReset} />);
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "Enter" });
    fireEvent.doubleClick(separator);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it("drags with the pointer and reports dragging", () => {
    const onDraggingChange = vi.fn();
    render(<Harness onDraggingChange={onDraggingChange} />);
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => true);
    fireEvent.pointerDown(separator, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator, { clientX: 150, pointerId: 1 });
    expect(separator).toHaveAttribute("aria-valuenow", "280");
    fireEvent.pointerUp(separator, { clientX: 150, pointerId: 1 });
    expect(onDraggingChange.mock.calls).toEqual([[true], [false]]);
  });
});

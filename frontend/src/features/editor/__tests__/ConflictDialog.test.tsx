import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "@/api/testing/fetch-mock";
import { makeDraft } from "@/api/testing/fixtures";
import { createTestQueryClient } from "@/api/testing/query";
import { createMemoryBuffer } from "../autosave/buffer";
import { DraftSession } from "../autosave/draft-session";
import { ConflictDialog } from "../components/ConflictDialog";

vi.mock("../components/DiffView", () => import("./mocks/diff-view"));

const TIME = "2026-10-05T10:00:00Z";

function setup() {
  const server = createFetchMock().on(
    "GET",
    "/api/v1/themes/:id/draft",
    json(makeDraft({ css: "/* FIRST server change */", lock_version: 2 })),
  );
  vi.stubGlobal("fetch", server.fetch);
  const session = new DraftSession({
    themeId: "t1",
    draft: { css: "a{}", lock_version: 1, updated_at: TIME },
    save: vi.fn(),
    buffer: createMemoryBuffer(),
  });
  session.edit("a{mine}");
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ConflictDialog open onClose={() => {}} session={session} slug="grafana" />
    </QueryClientProvider>,
  );
  return { server, session };
}

const current = (lock: number) => ({
  etag: `"lv-${lock}"`,
  lock_version: lock,
  updated_by: null,
  updated_at: TIME,
});

afterEach(() => cleanup());

describe("ConflictDialog", () => {
  it("starts every new conflict without the diff of a previous one", async () => {
    const { server, session } = setup();
    act(() => session.markConflict(current(2), "save"));
    const dialog = await screen.findByRole("dialog", { name: "Draft elders gewijzigd" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Diff bekijken" }));
    expect(await within(dialog).findByText("Server (lock 2)")).toBeInTheDocument();

    // Het conflict verdwijnt zonder dat de dialoog gesloten werd (bv. overschrijven → offline).
    act(() =>
      session.replaceWithServer({
        css: "/* FIRST server change */",
        lock_version: 3,
        updated_at: TIME,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    // Later een nieuw conflict: geen oude diff, wel weer de knop om hem te laden.
    server.on(
      "GET",
      "/api/v1/themes/:id/draft",
      json(makeDraft({ css: "/* SECOND server change */", lock_version: 4 })),
    );
    act(() => {
      session.edit("a{mine again}");
      session.markConflict(current(4), "save");
    });
    const again = await screen.findByRole("dialog", { name: "Draft elders gewijzigd" });
    expect(within(again).queryByText("Server (lock 2)")).toBeNull();
    expect(within(again).queryByText(/FIRST server change/)).toBeNull();
    fireEvent.click(within(again).getByRole("button", { name: "Diff bekijken" }));
    expect(await within(again).findByText("Server (lock 4)")).toBeInTheDocument();
    expect(
      within(again).getByLabelText("Verschil tussen de serverdraft en mijn versie"),
    ).toHaveTextContent("SECOND server change");
  });
});

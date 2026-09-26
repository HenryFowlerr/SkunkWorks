import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id, Machine, WorkshopSnapshot } from "@/contracts";
import { api } from "@/lib/api/client";

import { WorkshopsManager } from "./workshops-manager";

vi.mock("@/lib/api/client", () => ({
  api: {
    workshops: {
      list: vi.fn(),
      create: vi.fn(),
      saveVersion: vi.fn(),
      confirm: vi.fn(),
    },
  },
}));

afterEach(() => cleanup());

const workspaceId = "10000000-0000-4000-8000-000000000001" as Id;
const workshopId = "20000000-0000-4000-8000-000000000001" as Id;
const snapshotId = "30000000-0000-4000-8000-000000000001" as Id;
const savedSnapshotId = "30000000-0000-4000-8000-000000000002" as Id;
const machineId = "40000000-0000-4000-8000-000000000001" as Id;
function snapshot(options: {
  id?: Id;
  version?: number;
  name?: string;
  machines?: Machine[];
  confirmedBy?: Id | null;
  confirmedAt?: string | null;
} = {}): WorkshopSnapshot {
  return {
    id: options.id ?? snapshotId,
    workshopId,
    workspaceId,
    version: options.version ?? 1,
    name: options.name ?? "South workshop",
    machines: options.machines ?? [],
    confirmedBy: options.confirmedBy ?? null,
    confirmedAt: options.confirmedAt ?? null,
  };
}

function machine(name = "Brake A"): Machine {
  return {
    id: machineId,
    name,
    process: "Press brake",
    model: null,
    usableBendLengthMm: {
      value: null,
      evidence: [],
      evidenceState: "not_found",
      originalText: null,
    },
    tools: [],
    notes: [],
    approvedOrderConstraints: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.workshops.list).mockResolvedValue([]);
});

describe("workshop profile manager", () => {
  it("keeps an unspecified bend length explicitly unknown and saves several machines in the first immutable version", async () => {
    const base = snapshot();
    const savedMachines = [machine("Brake A"), { ...machine("Folder B"), id: "40000000-0000-4000-8000-000000000002" as Id }];
    const saved = snapshot({ id: savedSnapshotId, version: 2, name: "South workshop", machines: savedMachines });
    vi.mocked(api.workshops.create).mockResolvedValue(base);
    vi.mocked(api.workshops.saveVersion).mockResolvedValue(saved);

    render(<WorkshopsManager workspaceId={workspaceId} role="fabricator" />);
    expect(await screen.findByRole("heading", { name: "Create a workshop profile" })).toBeVisible();
    expect(screen.getByText("Unknown · not found in source")).toBeVisible();

    fireEvent.change(screen.getByRole("textbox", { name: "Workshop name" }), { target: { value: "South workshop" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 name" }), { target: { value: "Brake A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 process" }), { target: { value: "Press brake" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another machine" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 2 name" }), { target: { value: "Folder B" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 2 process" }), { target: { value: "Folding" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile with first version" }));

    expect(await screen.findByText("Version 2 saved with 2 machines.")).toBeVisible();
    expect(api.workshops.create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      name: "South workshop",
      idempotencyKey: expect.any(String),
    }));
    const saveInput = vi.mocked(api.workshops.saveVersion).mock.calls[0]?.[0];
    expect(saveInput?.expectedVersion).toBe(1);
    expect(saveInput?.machines).toHaveLength(2);
    expect(saveInput?.machines[0]?.usableBendLengthMm).toEqual({
      value: null,
      evidence: [],
      evidenceState: "not_found",
      originalText: null,
    });
  });

  it("preserves edited values and reports the real API failure when saving a new version fails", async () => {
    vi.mocked(api.workshops.list).mockResolvedValue([snapshot({ machines: [machine()] })]);
    vi.mocked(api.workshops.saveVersion).mockRejectedValue(new Error("Version conflict: reload the current profile."));

    render(<WorkshopsManager workspaceId={workspaceId} role="fabricator" />);
    const machineName = await screen.findByRole("textbox", { name: "Machine 1 name" });
    fireEvent.change(machineName, { target: { value: "Updated press brake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new version" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Version conflict: reload the current profile.");
    expect(screen.getByRole("textbox", { name: "Machine 1 name" })).toHaveValue("Updated press brake");
    expect(api.workshops.saveVersion).toHaveBeenCalledTimes(1);
  });

  it("saves multiple tools and ties each order constraint to a new unconfirmed note", async () => {
    vi.mocked(api.workshops.create).mockResolvedValue(snapshot());
    vi.mocked(api.workshops.saveVersion).mockImplementation(async (input) => snapshot({
      id: savedSnapshotId,
      version: 2,
      name: input.name,
      machines: input.machines.map((inputMachine) => ({
        ...inputMachine,
        notes: inputMachine.notes.map((note) => ({
          ...note,
          authorId: null,
          createdAt: "2026-09-26T01:00:00.000Z",
          confirmedBy: null,
        })),
      })),
    }));

    render(<WorkshopsManager workspaceId={workspaceId} role="fabricator" />);
    await screen.findByRole("heading", { name: "Create a workshop profile" });
    fireEvent.change(screen.getByRole("textbox", { name: "Workshop name" }), { target: { value: "South workshop" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 name" }), { target: { value: "Brake A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 process" }), { target: { value: "Press brake" } });

    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 tool 1 name" }), { target: { value: "V die" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 tool 1 specification" }), { target: { value: "90 degree, 12 mm opening" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tool" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 tool 2 name" }), { target: { value: "Punch" } });

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Machine 1 process note 1" }), { target: { value: "Keep the relief edge toward the operator." } });
    fireEvent.click(screen.getByRole("button", { name: "Add constraint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Bend that comes first" }), { target: { value: "B2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Bend that follows" }), { target: { value: "B3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Part family this applies to" }), { target: { value: "brackets" } });
    fireEvent.click(screen.getByRole("button", { name: "Create profile with first version" }));

    await screen.findByText("Version 2 saved with 1 machine.");
    const savedInput = vi.mocked(api.workshops.saveVersion).mock.calls[0]?.[0];
    const savedMachine = savedInput?.machines[0];
    expect(savedMachine?.tools).toHaveLength(2);
    expect(savedMachine?.tools[0]?.specification).toBe("90 degree, 12 mm opening");
    expect(savedMachine?.notes[0]).not.toHaveProperty("confirmedBy");
    expect(savedMachine?.notes[0]?.source).toBeNull();
    expect(savedMachine?.approvedOrderConstraints[0]?.noteId).toBe(savedMachine?.notes[0]?.id);
  });

  it("does not offer version confirmation to a designer, while offering it to a fabricator", async () => {
    vi.mocked(api.workshops.list).mockResolvedValue([snapshot({ machines: [machine()] })]);

    const view = render(<WorkshopsManager workspaceId={workspaceId} role="designer" />);
    await screen.findByRole("heading", { name: "Manufacturers" });
    expect(screen.queryByRole("button", { name: "Save new version" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New manufacturer" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Machine 1 name" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm this version" })).not.toBeInTheDocument();

    view.rerender(<WorkshopsManager workspaceId={workspaceId} role="fabricator" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm this version" })).toBeVisible());
  });

  it("only reports confirmation from the returned snapshot fields", async () => {
    const confirmedBy = "50000000-0000-4000-8000-000000000001" as Id;
    const confirmedAt = "2026-09-26T01:00:00.000Z";
    vi.mocked(api.workshops.list).mockResolvedValue([snapshot({ machines: [machine()] })]);
    vi.mocked(api.workshops.confirm).mockResolvedValue(snapshot({
      id: savedSnapshotId,
      version: 1,
      machines: [machine()],
      confirmedBy,
      confirmedAt,
    }));

    render(<WorkshopsManager workspaceId={workspaceId} role="fabricator" />);
    await screen.findByRole("button", { name: "Confirm this version" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm this version" }));

    expect(await screen.findByText("Version 1 confirmed by the server.")).toBeVisible();
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(api.workshops.confirm).toHaveBeenCalledWith({ workshopId, snapshotId });
  });
});

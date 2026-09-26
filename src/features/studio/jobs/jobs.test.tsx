import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Job, WorkshopSnapshot } from "@/contracts";
import { JobsDashboard } from "./jobs-dashboard";
import { JOB_FILE_LIMITS, NewJobIntake } from "./new-job-intake";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    jobs: { list: vi.fn(), create: vi.fn(), updateInputs: vi.fn() },
    workshops: { list: vi.fn() },
    assets: { uploadAsset: vi.fn() },
  },
}));

vi.mock("@/lib/api/client", () => ({ api: apiMock }));

const ids = {
  workspace: "f83887b2-ea69-4c13-aada-19127e8360d1",
  workshop: "6ea7b6ad-4a85-4aa9-8370-dbcf2daff1d4",
  snapshot: "dbd5215e-1b11-4c89-9d9f-5f5f08877b73",
  machine: "bc9a725f-56d1-4878-b90f-7820424886a2",
  job: "ab17ef88-c9c4-4f69-b253-bba5e2522d59",
  pdf: "c45d15be-2fb9-4a93-9a02-d7d52d273431",
  glb: "998bfb78-4534-49c8-8bb2-19b35232c67d",
  stl: "2be5d7ac-5d67-4e97-b7fd-3b3620ee0a63",
};

const timestamp = "2026-09-26T00:00:00.000Z";
const workshopSnapshot: WorkshopSnapshot = {
  id: ids.snapshot,
  workshopId: ids.workshop,
  workspaceId: ids.workspace,
  version: 3,
  name: "Christchurch Press Shop",
  machines: [{
    id: ids.machine,
    name: "Brake 02",
    process: "Press brake",
    model: "X-200",
    usableBendLengthMm: { value: 2400, evidence: [], evidenceState: "supported", originalText: "2400 mm" },
    tools: [],
    notes: [],
    approvedOrderConstraints: [],
  }],
  confirmedBy: "e135a1a1-5a38-4740-8b45-76d929697aec",
  confirmedAt: timestamp,
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: ids.job,
    workspaceId: ids.workspace,
    title: "Sensor mount",
    partNumber: "SM-104",
    partFamily: "straight-bend-bracket",
    version: 1,
    workshopSnapshotId: ids.snapshot,
    machineId: ids.machine,
    sourceAssetIds: [],
    draftId: null,
    latestReleaseId: null,
    createdAt: timestamp,
    ...overrides,
  };
}

function makeAsset(kind: Asset["kind"], id: string): Asset {
  return {
    id,
    jobId: ids.job,
    releaseId: null,
    kind,
    filename: kind === "drawing_pdf" ? "sensor.pdf" : kind === "model_glb" ? "sensor.glb" : kind === "model_stl" ? "Engineering test block (1).STL" : "sensor.json",
    mimeType: kind === "drawing_pdf" ? "application/pdf" : kind === "model_glb" ? "model/gltf-binary" : kind === "model_stl" ? "model/stl" : "application/json",
    byteSize: 32,
    sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    version: 1,
    status: "ready",
    drawingRevision: null,
  };
}

function sourceFiles() {
  return {
    pdf: new File(["%PDF-1.7"], "sensor.pdf", { type: "application/pdf" }),
    glb: new File(["glTF"], "sensor.glb", { type: "model/gltf-binary" }),
    stl: new File(["solid sensor"], "Engineering test block (1).STL", { type: "model/stl" }),
  };
}

function fillRequiredFields() {
  const files = sourceFiles();
  fireEvent.change(screen.getByLabelText("Part number"), { target: { value: "SM-104" } });
  fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Sensor mount" } });
  fireEvent.change(screen.getByLabelText("Part family"), { target: { value: "straight-bend-bracket" } });
  fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: ids.snapshot } });
  fireEvent.change(screen.getByLabelText("Machine"), { target: { value: ids.machine } });
  fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), { target: { files: [files.pdf] } });
  fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [files.glb] } });
  return files;
}

function submitForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("Intake form not found.");
  fireEvent.submit(form);
}

describe("designer jobs and intake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.jobs.list.mockResolvedValue([]);
    apiMock.workshops.list.mockResolvedValue([workshopSnapshot]);
    apiMock.jobs.create.mockResolvedValue(makeJob());
    apiMock.jobs.updateInputs.mockImplementation(async (input: { sourceAssetIds: string[]; partFamily: string; workshopSnapshotId: string; machineId: string }) => makeJob({
      sourceAssetIds: input.sourceAssetIds,
      partFamily: input.partFamily,
      workshopSnapshotId: input.workshopSnapshotId,
      machineId: input.machineId,
      version: 2,
    }));
    apiMock.assets.uploadAsset.mockImplementation(async (input: { kind: Asset["kind"] }) =>
      makeAsset(input.kind, input.kind === "drawing_pdf" ? ids.pdf : input.kind === "model_stl" ? ids.stl : ids.glb));
  });

  afterEach(() => cleanup());

  it("retains a native SolidWorks pair without pretending exports or AI analysis exist", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), { target: { files: [] } });
    fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [] } });
    fireEvent.change(screen.getByLabelText(/Native SolidWorks part/), {
      target: { files: [new File(["opaque part"], "Engineering test block.SLDPRT")] },
    });
    fireEvent.change(screen.getByLabelText(/Native SolidWorks drawing/), {
      target: { files: [new File(["opaque drawing"], "Engineering test block.SLDDRW")] },
    });
    apiMock.assets.uploadAsset.mockImplementation(async ({ kind }: { kind: Asset["kind"] }) =>
      makeAsset(kind, kind === "native_part" ? ids.glb : ids.pdf));
    submitForm(container);
    await screen.findByText("Inputs saved");
    expect(apiMock.assets.uploadAsset.mock.calls.map(([input]) => input.kind)).toEqual(["native_part", "native_drawing"]);
    expect(screen.getAllByText("Source retained")).toHaveLength(2);
    expect(screen.getByText(/Exports needed:/)).toHaveTextContent("Native sources remain private provenance files and are not AI drawing evidence");
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledWith(expect.objectContaining({ sourceAssetIds: [ids.glb, ids.pdf] }));
  });

  it("accepts the supplied drawing PDF and STL pair while keeping the mesh visual-only", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const files = fillRequiredFields();
    const drawing = new File(["%PDF-1.7"], "Engineering test block (1).pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), { target: { files: [drawing] } });
    fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [] } });
    fireEvent.change(screen.getByLabelText(/^3D model \(STL visual reference\)/), { target: { files: [files.stl] } });

    submitForm(container);

    await screen.findByText("Inputs saved");
    expect(apiMock.assets.uploadAsset.mock.calls.map(([input]) => input.kind)).toEqual(["drawing_pdf", "model_stl"]);
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledWith(expect.objectContaining({ sourceAssetIds: [ids.pdf, ids.stl] }));
    expect(screen.getByText(/STL visual reference/)).toBeInTheDocument();
  });

  it("loads the workspace list from the API and exposes the open action", async () => {
    const existing = makeJob({ sourceAssetIds: [ids.pdf, ids.glb] });
    apiMock.jobs.list.mockResolvedValue([existing]);
    const onOpenJob = vi.fn();
    render(<JobsDashboard workspaceId={ids.workspace} onOpenJob={onOpenJob} />);

    const open = await screen.findByRole("button", { name: "Open job" });
    expect(screen.getByText("Sensor mount")).toBeInTheDocument();
    fireEvent.click(open);
    expect(onOpenJob).toHaveBeenCalledWith(existing);
    expect(apiMock.jobs.list).toHaveBeenCalledWith({ workspaceId: ids.workspace });
  });

  it("offers designer intake while keeping the fabricator queue focused on shared jobs", async () => {
    apiMock.jobs.list.mockResolvedValue([]);
    const designer = render(<JobsDashboard workspaceId={ids.workspace} role="designer" />);
    expect(screen.getByRole("link", { name: "Start job" })).toHaveAttribute(
      "href", `/studio/jobs/new?workspace=${ids.workspace}`,
    );

    designer.rerender(<JobsDashboard workspaceId={ids.workspace} role="fabricator" />);
    expect(screen.getByRole("heading", { name: "Workshop jobs" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start job" })).not.toBeInTheDocument();
  });

  it("reports a real job-list API failure without rendering fixture rows", async () => {
    apiMock.jobs.list.mockRejectedValue(new Error("UNAUTHENTICATED: sign in to view workspace jobs."));
    render(<JobsDashboard workspaceId={ids.workspace} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("UNAUTHENTICATED: sign in to view workspace jobs.");
    expect(screen.queryByText("Sensor mount")).not.toBeInTheDocument();
  });

  it("labels a partially attached source set as incomplete", async () => {
    apiMock.jobs.list.mockResolvedValue([makeJob({ sourceAssetIds: [ids.pdf] })]);
    render(<JobsDashboard workspaceId={ids.workspace} />);

    expect(await screen.findByText("Sensor mount")).toBeInTheDocument();
    expect(screen.getByText("Intake incomplete")).toBeInTheDocument();
  });

  it("keeps previously loaded jobs visible with a stale-data notice when refresh fails", async () => {
    apiMock.jobs.list.mockResolvedValueOnce([makeJob({ sourceAssetIds: [ids.pdf, ids.glb] })]);
    const onOpenJob = vi.fn();
    render(<JobsDashboard workspaceId={ids.workspace} onOpenJob={onOpenJob} />);
    await screen.findByRole("button", { name: "Open job" });
    apiMock.jobs.list.mockRejectedValueOnce(new Error("The workspace is temporarily unavailable."));
    fireEvent.click(screen.getByRole("button", { name: "Refresh jobs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The workspace is temporarily unavailable.");
    expect(screen.getByRole("status")).toHaveTextContent("Showing the last loaded jobs; refresh did not complete.");
    expect(screen.getByText("Sensor mount")).toBeInTheDocument();
  });

  it("validates all required intake fields before creating a server job", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: "Christchurch Press Shop · v3" });
    fireEvent.change(screen.getByLabelText("Part number"), { target: { value: "SM-104" } });
    fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: ids.snapshot } });
    submitForm(container);

    expect(await screen.findByText("Enter a job title.")).toBeInTheDocument();
    expect(screen.getByText("Enter a part family.")).toBeInTheDocument();
    expect(screen.getByText("This source file is required.")).toBeInTheDocument();
    expect(screen.getByText("Attach a viewable GLB or STL model, or retain a native part source.")).toBeInTheDocument();
    expect(apiMock.jobs.create).not.toHaveBeenCalled();
  });

  it("rejects an unsupported source file type before creating a job", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const files = sourceFiles();
    fireEvent.change(screen.getByLabelText("Part number"), { target: { value: "SM-104" } });
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Sensor mount" } });
    fireEvent.change(screen.getByLabelText("Part family"), { target: { value: "straight-bend-bracket" } });
    fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: ids.snapshot } });
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: ids.machine } });
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), {
      target: { files: [new File(["not a drawing"], "sensor.txt", { type: "text/plain" })] },
    });
    fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [files.glb] } });
    submitForm(container);

    expect(await screen.findByText("Choose a .pdf file.")).toBeInTheDocument();
    expect(apiMock.jobs.create).not.toHaveBeenCalled();
  });

  it("rejects a file above its advertised size limit before creating a job", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const files = sourceFiles();
    Object.defineProperty(files.pdf, "size", { value: JOB_FILE_LIMITS.drawing_pdf + 1 });
    fireEvent.change(screen.getByLabelText("Part number"), { target: { value: "SM-104" } });
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Sensor mount" } });
    fireEvent.change(screen.getByLabelText("Part family"), { target: { value: "straight-bend-bracket" } });
    fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: ids.snapshot } });
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: ids.machine } });
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), { target: { files: [files.pdf] } });
    fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [files.glb] } });
    submitForm(container);

    expect(await screen.findByText("Choose a file no larger than 25 MiB.")).toBeInTheDocument();
    expect(apiMock.jobs.create).not.toHaveBeenCalled();
  });

  it("requires an authored manifest selection to contain valid JSON", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const files = sourceFiles();
    fireEvent.change(screen.getByLabelText("Part number"), { target: { value: "SM-104" } });
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Sensor mount" } });
    fireEvent.change(screen.getByLabelText("Part family"), { target: { value: "straight-bend-bracket" } });
    fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: ids.snapshot } });
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: ids.machine } });
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), { target: { files: [files.pdf] } });
    fireEvent.change(screen.getByLabelText(/^3D model \(GLB CAD export\)/), { target: { files: [files.glb] } });
    fireEvent.change(screen.getByLabelText(/Authored bend manifest/), {
      target: { files: [new File(["{ incomplete"], "bend-map.json", { type: "application/json" })] },
    });
    submitForm(container);

    expect(await screen.findByText("The manifest must contain valid JSON.")).toBeInTheDocument();
    expect(apiMock.jobs.create).not.toHaveBeenCalled();
  });

  it("keeps the chosen files and job details after an API upload failure so the designer can retry", async () => {
    apiMock.assets.uploadAsset.mockRejectedValueOnce(new Error("FORBIDDEN: this account cannot add source files."));
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const files = fillRequiredFields();
    submitForm(container);

    expect(await screen.findAllByText("FORBIDDEN: this account cannot add source files.")).toHaveLength(2);
    expect(screen.getByLabelText("Part number")).toHaveValue("SM-104");
    expect(screen.getByLabelText(/Technical drawing PDFs/)).toHaveProperty("files.0.name", files.pdf.name);
    expect(screen.getByRole("button", { name: "Retry uploads and save intake" })).toBeInTheDocument();
    expect(apiMock.jobs.create).toHaveBeenCalledTimes(1);

    apiMock.assets.uploadAsset.mockImplementation(async (input: { kind: Asset["kind"] }) =>
      makeAsset(input.kind, input.kind === "drawing_pdf" ? ids.pdf : ids.glb));
    fireEvent.click(screen.getByRole("button", { name: "Retry uploads and save intake" }));
    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());
    expect(apiMock.jobs.create).toHaveBeenCalledTimes(1);
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledTimes(1);
    expect(apiMock.assets.uploadAsset.mock.calls[0][0].idempotencyKey)
      .toBe(apiMock.assets.uploadAsset.mock.calls[1][0].idempotencyKey);
  });

  it("reuses a failed file upload key and skips a file the server already verified on retry", async () => {
    const uploadedKinds: Asset["kind"][] = [];
    apiMock.assets.uploadAsset.mockImplementation(async (input: { kind: Asset["kind"] }) => {
      uploadedKinds.push(input.kind);
      if (input.kind === "model_glb" && uploadedKinds.filter((kind) => kind === "model_glb").length === 1) {
        throw new Error("The connection closed before upload confirmation.");
      }
      return makeAsset(input.kind, input.kind === "drawing_pdf" ? ids.pdf : ids.glb);
    });
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: "Christchurch Press Shop · v3" });
    fillRequiredFields();
    submitForm(container);

    expect(await screen.findByRole("alert")).toHaveTextContent("The connection closed before upload confirmation.");
    fireEvent.click(screen.getByRole("button", { name: "Retry uploads and save intake" }));
    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());

    expect(uploadedKinds).toEqual(["drawing_pdf", "model_glb", "model_glb"]);
    const modelUploadKey = apiMock.assets.uploadAsset.mock.calls[1][0].idempotencyKey;
    expect(apiMock.assets.uploadAsset.mock.calls[2][0].idempotencyKey).toBe(modelUploadKey);
    expect(apiMock.jobs.create).toHaveBeenCalledTimes(1);
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledTimes(1);
  });

  it("does not start duplicate job creation when the intake is submitted twice quickly", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    fillRequiredFields();
    submitForm(container);
    submitForm(container);

    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());
    expect(apiMock.jobs.create).toHaveBeenCalledTimes(1);
    expect(apiMock.assets.uploadAsset).toHaveBeenCalledTimes(2);
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledTimes(1);
  });

  it("reuses its job idempotency key when creation can be retried without changing the intake", async () => {
    const createKeys: string[] = [];
    apiMock.jobs.create.mockImplementation(async (input: {
      idempotencyKey: string;
      partFamily: string;
      workshopSnapshotId: string;
      machineId: string;
    }) => {
      createKeys.push(input.idempotencyKey);
      if (createKeys.length === 1) throw new Error("The connection closed before the job response arrived.");
      return makeJob({
        partFamily: input.partFamily,
        workshopSnapshotId: input.workshopSnapshotId,
        machineId: input.machineId,
      });
    });
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    fillRequiredFields();
    submitForm(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("The connection closed before the job response arrived.");

    submitForm(container);
    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());
    expect(createKeys).toHaveLength(2);
    expect(createKeys[1]).toBe(createKeys[0]);
  });

  it("uses a fresh job idempotency key after an unconfirmed create is edited", async () => {
    const nextMachineId = "17b4c632-6c5b-473a-af70-6bc980dd673f";
    const nextSnapshot: WorkshopSnapshot = {
      ...workshopSnapshot,
      id: "238197d0-565c-4f10-8748-d4dcc26ce1ad",
      version: 4,
      machines: [{ ...workshopSnapshot.machines[0], id: nextMachineId, name: "Brake 03" }],
    };
    apiMock.workshops.list.mockResolvedValue([workshopSnapshot, nextSnapshot]);
    const createKeys: string[] = [];
    apiMock.jobs.create.mockImplementation(async (input: {
      idempotencyKey: string;
      partFamily: string;
      workshopSnapshotId: string;
      machineId: string;
    }) => {
      createKeys.push(input.idempotencyKey);
      if (createKeys.length === 1) throw new Error("The job response was lost.");
      return makeJob({
        partFamily: input.partFamily,
        workshopSnapshotId: input.workshopSnapshotId,
        machineId: input.machineId,
      });
    });
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: "Christchurch Press Shop · v3" });
    fillRequiredFields();
    submitForm(container);
    expect(await screen.findByRole("alert")).toHaveTextContent("The job response was lost.");

    fireEvent.change(screen.getByLabelText("Manufacturer and confirmed profile"), { target: { value: nextSnapshot.id } });
    fireEvent.change(screen.getByLabelText("Machine"), { target: { value: nextMachineId } });
    submitForm(container);
    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());

    expect(createKeys).toHaveLength(2);
    expect(createKeys[1]).not.toBe(createKeys[0]);
  });

  it("does not attach or mark an asset ready without the server verified digest", async () => {
    apiMock.assets.uploadAsset.mockResolvedValueOnce({
      ...makeAsset("drawing_pdf", ids.pdf),
      status: "pending",
      sha256: null,
    });
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    fillRequiredFields();
    submitForm(container);

    expect(await screen.findAllByText(/ready file with a server-verified SHA-256 hash/)).toHaveLength(2);
    expect(apiMock.jobs.updateInputs).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ready · SHA-256/)).not.toBeInTheDocument();
  });

  it("uploads multiple technical drawings and attaches every verified PDF to the job", async () => {
    const secondId = "967df638-397b-49be-bd02-a31c83a66322";
    apiMock.assets.uploadAsset.mockImplementation(async (input: { kind: Asset["kind"]; file: File }) =>
      makeAsset(input.kind, input.file.name === "detail.pdf" ? secondId : input.kind === "drawing_pdf" ? ids.pdf : ids.glb));
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Technical drawing PDFs/), {
      target: { files: [new File(["%PDF-1.7"], "sensor.pdf", { type: "application/pdf" }), new File(["%PDF-1.7"], "detail.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByRole("list", { name: "Additional drawings" })).toHaveTextContent("detail.pdf");
    submitForm(container);
    await waitFor(() => expect(screen.getByText(/server confirmed the job setup/i)).toBeInTheDocument());
    expect(apiMock.assets.uploadAsset).toHaveBeenCalledTimes(3);
    expect(apiMock.jobs.updateInputs).toHaveBeenCalledWith(expect.objectContaining({ sourceAssetIds: [ids.pdf, ids.glb, secondId] }));
  });

  it("rejects a dropped native CAD file rather than implying it can be processed", async () => {
    const { container } = render(<NewJobIntake workspaceId={ids.workspace} />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    const modelDrop = screen.getByLabelText(/^3D model \(GLB CAD export\)/).parentElement;
    if (!modelDrop) throw new Error("Model drop target not found.");
    fireEvent.drop(modelDrop, { dataTransfer: { files: [new File(["native"], "part.sldprt", { type: "application/octet-stream" })] } });
    expect(screen.getByText("Choose a .glb file.")).toBeInTheDocument();
    submitForm(container);
    expect(apiMock.jobs.create).not.toHaveBeenCalled();
  });

  it("keeps job intake designer-only and points other roles to supported actions", async () => {
    const view = render(<NewJobIntake workspaceId={ids.workspace} role="designer" />);
    await screen.findByRole("option", { name: /Christchurch Press Shop/ });
    expect(screen.getByText(/Ask a workspace admin to invite a fabricator/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    view.rerender(<NewJobIntake workspaceId={ids.workspace} role="admin" />);
    expect(screen.getByRole("link", { name: /Create a designer or fabricator invitation link/ })).toHaveAttribute("href", `/studio/invites?workspace=${ids.workspace}`);
    expect(screen.queryByRole("button", { name: /Create job/ })).not.toBeInTheDocument();

    view.rerender(<NewJobIntake workspaceId={ids.workspace} role="fabricator" />);
    expect(screen.getByRole("link", { name: /Open manufacturer setup/ })).toHaveAttribute("href", `/studio/workshops?workspace=${ids.workspace}`);
  });

  it("surfaces workshop endpoint and authorization errors verbatim", async () => {
    apiMock.workshops.list.mockRejectedValue(new Error("UNAUTHENTICATED: workspace session has expired."));
    render(<NewJobIntake workspaceId={ids.workspace} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("UNAUTHENTICATED: workspace session has expired.");
    expect(screen.getByRole("button", { name: "Retry workshop list" })).toBeInTheDocument();
  });
});

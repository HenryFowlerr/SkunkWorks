import { z } from "zod";

const uuid = z.string().uuid();
const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();
const utcTimestamp = z.iso.datetime();

export const IdSchema = uuid;
export type Id = z.infer<typeof IdSchema>;

export const Vec2Schema = z.tuple([finiteNumber, finiteNumber]);
export type Vec2 = z.infer<typeof Vec2Schema>;

export const Vec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const RoleSchema = z.enum(["admin", "designer", "fabricator"]);
export type Role = z.infer<typeof RoleSchema>;

export const EvidenceStateSchema = z.enum([
  "supported",
  "conflict",
  "not_found",
  "unreadable",
]);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

const EvidenceRegionSchema = z
  .tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber])
  .superRefine(([x, y, width, height], ctx) => {
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      ctx.addIssue({ code: "custom", message: "Evidence regions must fit inside normalized page bounds." });
    }
  });

export const EvidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    assetId: IdSchema,
    page: z.number().int().min(1),
    region: EvidenceRegionSchema.nullable(),
    excerpt: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("workshop_note"),
    snapshotId: IdSchema,
    machineId: IdSchema,
    noteId: IdSchema,
  }).strict(),
  z.object({
    kind: z.literal("human_clarification"),
    recordId: IdSchema,
  }).strict(),
]);
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export function SourcedValueSchema<TValue extends z.ZodType>(valueSchema: TValue) {
  return z.object({
    value: valueSchema.nullable(),
    evidence: z.array(EvidenceRefSchema),
    evidenceState: EvidenceStateSchema,
    originalText: z.string().nullable(),
  }).strict();
}

export const ActorSchema = z.object({
  id: IdSchema,
  displayName: nonEmptyString,
  kind: z.enum(["member", "release_visitor"]),
  roles: z.array(RoleSchema),
}).strict();
export type Actor = z.infer<typeof ActorSchema>;

export const WorkspaceSchema = z.object({
  id: IdSchema,
  name: nonEmptyString,
  createdAt: utcTimestamp,
}).strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMembershipSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  userId: IdSchema,
  role: RoleSchema,
  createdAt: utcTimestamp,
}).strict();
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;

export const WorkspaceInviteSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  role: RoleSchema,
  createdAt: utcTimestamp,
  expiresAt: utcTimestamp,
  inviteUrl: z.string().url(),
}).strict();
export type WorkspaceInvite = z.infer<typeof WorkspaceInviteSchema>;

export const AssetSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  releaseId: IdSchema.nullable(),
  kind: z.enum(["drawing_pdf", "model_glb", "bend_manifest", "issue_photo"]),
  filename: nonEmptyString,
  mimeType: nonEmptyString,
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable(),
  version: z.number().int().positive(),
  status: z.enum(["pending", "ready", "failed"]),
  drawingRevision: z.string().nullable(),
}).strict().superRefine((asset, ctx) => {
  if (asset.kind === "issue_photo" && asset.releaseId === null) {
    ctx.addIssue({ code: "custom", path: ["releaseId"], message: "Issue photos must belong to a release." });
  }
  if (asset.kind !== "issue_photo" && asset.releaseId !== null) {
    ctx.addIssue({ code: "custom", path: ["releaseId"], message: "Source assets are job-scoped and cannot belong to a release." });
  }
  if (asset.status === "ready" && asset.sha256 === null) {
    ctx.addIssue({ code: "custom", path: ["sha256"], message: "Ready assets require a server-verified SHA-256 digest." });
  }
});
export type Asset = z.infer<typeof AssetSchema>;

const NonNegativeSourcedNumberSchema = SourcedValueSchema(finiteNumber.refine((value) => value >= 0));

export const MachineSchema = z.object({
  id: IdSchema,
  name: nonEmptyString,
  process: nonEmptyString,
  model: z.string().nullable(),
  usableBendLengthMm: NonNegativeSourcedNumberSchema,
  tools: z.array(z.object({
    id: IdSchema,
    name: nonEmptyString,
    specification: z.string().nullable(),
    evidence: z.array(EvidenceRefSchema),
  }).strict()),
  notes: z.array(z.object({
    id: IdSchema,
    text: nonEmptyString,
    confirmedBy: IdSchema.nullable(),
  }).strict()),
  approvedOrderConstraints: z.array(z.object({
    beforeBendId: nonEmptyString,
    afterBendId: nonEmptyString,
    appliesToPartFamily: nonEmptyString,
    noteId: IdSchema,
  }).strict()),
}).strict();
export type Machine = z.infer<typeof MachineSchema>;

export const WorkshopSnapshotSchema = z.object({
  id: IdSchema,
  workshopId: IdSchema,
  workspaceId: IdSchema,
  version: z.number().int().positive(),
  name: nonEmptyString,
  machines: z.array(MachineSchema),
  confirmedBy: IdSchema.nullable(),
  confirmedAt: utcTimestamp.nullable(),
}).strict().superRefine((snapshot, ctx) => {
  const machineIds = snapshot.machines.map((machine) => machine.id);
  if (new Set(machineIds).size !== machineIds.length) {
    ctx.addIssue({ code: "custom", path: ["machines"], message: "Machine IDs must be unique within a workshop snapshot." });
  }
  if ((snapshot.confirmedBy === null) !== (snapshot.confirmedAt === null)) {
    ctx.addIssue({ code: "custom", path: ["confirmedBy"], message: "Confirmation actor and timestamp must be present together." });
  }
});
export type WorkshopSnapshot = z.infer<typeof WorkshopSnapshotSchema>;

export const PanelSchema = z.object({
  id: nonEmptyString,
  polygonMm: z.array(Vec2Schema).min(3),
}).strict().superRefine((panel, ctx) => {
  if (Math.abs(polygonArea(panel.polygonMm)) < 1e-8) {
    ctx.addIssue({ code: "custom", path: ["polygonMm"], message: "Panel polygon must have nonzero area." });
  }
  if (hasSelfIntersection(panel.polygonMm)) {
    ctx.addIssue({ code: "custom", path: ["polygonMm"], message: "Panel polygon must not self-intersect." });
  }
});
export type Panel = z.infer<typeof PanelSchema>;

export const HingeSchema = z.object({
  id: nonEmptyString,
  parentPanelId: nonEmptyString,
  childPanelId: nonEmptyString,
  axisStartMm: Vec2Schema,
  axisEndMm: Vec2Schema,
}).strict();
export type Hinge = z.infer<typeof HingeSchema>;

const PANEL_EDGE_TOLERANCE_MM = 0.5;

function panelModelFields() {
  return {
    schemaVersion: z.literal("1.0"),
    units: z.literal("mm"),
    thicknessMm: finiteNumber.positive(),
    rootPanelId: nonEmptyString,
    panels: z.array(PanelSchema).min(1),
    hinges: z.array(HingeSchema),
    origin: z.enum(["authored_manifest", "reviewer_mapped", "ai_proposed"]),
    referenceFaceLabel: nonEmptyString,
  };
}

function validatePanelModel(
  model: { rootPanelId: string; panels: Panel[]; hinges: Hinge[] },
  ctx: z.RefinementCtx,
) {
  const panelById = new Map<string, Panel>();
  model.panels.forEach((panel, index) => {
    if (panelById.has(panel.id)) {
      ctx.addIssue({ code: "custom", path: ["panels", index, "id"], message: "Panel IDs must be unique." });
    }
    panelById.set(panel.id, panel);
  });
  if (!panelById.has(model.rootPanelId)) {
    ctx.addIssue({ code: "custom", path: ["rootPanelId"], message: "Root panel must exist in panels." });
  }

  const hingeIds = new Set<string>();
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();
  model.hinges.forEach((hinge, index) => {
    if (hingeIds.has(hinge.id)) {
      ctx.addIssue({ code: "custom", path: ["hinges", index, "id"], message: "Hinge IDs must be unique." });
    }
    hingeIds.add(hinge.id);
    const parent = panelById.get(hinge.parentPanelId);
    const child = panelById.get(hinge.childPanelId);
    if (!parent) {
      ctx.addIssue({ code: "custom", path: ["hinges", index, "parentPanelId"], message: "Hinge parent panel does not exist." });
    }
    if (!child) {
      ctx.addIssue({ code: "custom", path: ["hinges", index, "childPanelId"], message: "Hinge child panel does not exist." });
    }
    if (hinge.parentPanelId === hinge.childPanelId) {
      ctx.addIssue({ code: "custom", path: ["hinges", index], message: "A hinge cannot connect a panel to itself." });
    }
    if (parent && child) {
      if (parentByChild.has(hinge.childPanelId)) {
        ctx.addIssue({ code: "custom", path: ["hinges", index, "childPanelId"], message: "Each non-root panel must have exactly one parent." });
      }
      parentByChild.set(hinge.childPanelId, hinge.parentPanelId);
      const children = childrenByParent.get(hinge.parentPanelId) ?? [];
      children.push(hinge.childPanelId);
      childrenByParent.set(hinge.parentPanelId, children);

      const axisLength = distance(hinge.axisStartMm, hinge.axisEndMm);
      if (axisLength <= 1e-8) {
        ctx.addIssue({ code: "custom", path: ["hinges", index], message: "Hinge axis length must be nonzero." });
      } else {
        for (const [label, panel] of [["parent", parent], ["child", child]] as const) {
          if (!segmentFollowsPolygonEdge(hinge.axisStartMm, hinge.axisEndMm, panel.polygonMm, PANEL_EDGE_TOLERANCE_MM)) {
            ctx.addIssue({ code: "custom", path: ["hinges", index], message: `Hinge axis must lie on a ${label} panel edge within ${PANEL_EDGE_TOLERANCE_MM} mm.` });
          }
        }
      }
    }
  });

  if (model.panels.length > 0) {
    if (parentByChild.has(model.rootPanelId)) {
      ctx.addIssue({ code: "custom", path: ["rootPanelId"], message: "Root panel cannot have a parent." });
    }
    for (const panel of model.panels) {
      if (panel.id !== model.rootPanelId && !parentByChild.has(panel.id)) {
        ctx.addIssue({ code: "custom", path: ["panels"], message: `Panel ${panel.id} is missing its parent hinge.` });
      }
    }
    if (model.hinges.length !== model.panels.length - 1) {
      ctx.addIssue({ code: "custom", path: ["hinges"], message: "A panel tree must contain exactly one hinge per non-root panel." });
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    let cycleFound = false;
    const visit = (panelId: string) => {
      if (active.has(panelId)) {
        cycleFound = true;
        return;
      }
      if (visited.has(panelId)) return;
      visited.add(panelId);
      active.add(panelId);
      for (const childId of childrenByParent.get(panelId) ?? []) visit(childId);
      active.delete(panelId);
    };
    if (panelById.has(model.rootPanelId)) visit(model.rootPanelId);
    if (cycleFound) ctx.addIssue({ code: "custom", path: ["hinges"], message: "Panel hinges must not contain cycles." });
    if (visited.size !== model.panels.length) {
      ctx.addIssue({ code: "custom", path: ["panels"], message: "Every panel must be connected to the root panel." });
    }
  }
}

export const PanelModelSchema = z.object({ ...panelModelFields(), reviewed: z.boolean() }).strict().superRefine(validatePanelModel);
export type PanelModel = z.infer<typeof PanelModelSchema>;

// Editable input intentionally has no `reviewed` field. The server derives that
// value from an authorised mapping/review record and rejects attempts to set it.
export const PanelModelInputSchema = z.object(panelModelFields()).strict().superRefine(validatePanelModel);
export type PanelModelInput = z.infer<typeof PanelModelInputSchema>;

export const BendSchema = z.object({
  bendId: nonEmptyString,
  hingeId: nonEmptyString.nullable(),
  finishedAngle: SourcedValueSchema(z.object({
    degrees: finiteNumber,
    convention: z.enum(["internal", "external", "from_flat"]),
  }).strict()),
  foldRotationDeg: SourcedValueSchema(finiteNumber),
  insideRadiusMm: SourcedValueSchema(finiteNumber.refine((value) => value >= 0)),
  directionText: SourcedValueSchema(z.string()),
}).strict();
export type Bend = z.infer<typeof BendSchema>;

export const StepSchema = z.object({
  id: IdSchema,
  bendId: nonEmptyString,
  instruction: nonEmptyString,
  evidence: z.array(EvidenceRefSchema),
  camera: z.object({ positionMm: Vec3Schema, targetMm: Vec3Schema }).strict().nullable(),
}).strict();
export type Step = z.infer<typeof StepSchema>;

const FindingFieldsSchema = z.object({
  id: IdSchema,
  kind: z.enum(["source_conflict", "missing_data", "capability", "mapping"]),
  severity: z.enum(["blocking", "review", "info"]),
  bendId: nonEmptyString.nullable(),
  message: nonEmptyString,
  evidence: z.array(EvidenceRefSchema),
  disposition: z.enum(["open", "resolved"]),
  resolutionRecordId: IdSchema.nullable(),
}).strict();

export const FindingSchema = FindingFieldsSchema.superRefine((finding, ctx) => {
  if ((finding.disposition === "resolved") !== (finding.resolutionRecordId !== null)) {
    ctx.addIssue({ code: "custom", path: ["resolutionRecordId"], message: "Resolved findings require a resolution record; open findings cannot have one." });
  }
});
export type Finding = z.infer<typeof FindingSchema>;

const MachineProposalFieldsSchema = z.object({
  id: IdSchema,
  snapshotId: IdSchema,
  machineId: IdSchema,
  proposedBendOrder: z.array(nonEmptyString),
  rationale: nonEmptyString,
  evidence: z.array(EvidenceRefSchema),
  status: z.enum(["proposed", "accepted", "rejected"]),
  decidedBy: IdSchema.nullable(),
}).strict();

export const MachineProposalSchema = MachineProposalFieldsSchema.superRefine((proposal, ctx) => {
  if ((proposal.status === "proposed") !== (proposal.decidedBy === null)) {
    ctx.addIssue({ code: "custom", path: ["decidedBy"], message: "Only a decided proposal has a decision actor." });
  }
  if (new Set(proposal.proposedBendOrder).size !== proposal.proposedBendOrder.length) {
    ctx.addIssue({ code: "custom", path: ["proposedBendOrder"], message: "A proposed bend order cannot repeat a bend ID." });
  }
});
export type MachineProposal = z.infer<typeof MachineProposalSchema>;

export const ReviewSchema = z.object({
  kind: z.enum(["design", "process"]),
  actorId: IdSchema,
  draftVersion: z.number().int().positive(),
  at: utcTimestamp,
}).strict();
export type Review = z.infer<typeof ReviewSchema>;

export const DraftContentSchema = z.object({
  sourceAssetIds: z.array(IdSchema),
  workshopSnapshotId: IdSchema,
  machineId: IdSchema,
  panelModel: PanelModelSchema.nullable(),
  bends: z.array(BendSchema),
  steps: z.array(StepSchema),
  findings: z.array(FindingSchema),
  machineProposals: z.array(MachineProposalSchema),
}).strict().superRefine((content, ctx) => {
  const bendIds = content.bends.map((bend) => bend.bendId);
  if (new Set(bendIds).size !== bendIds.length) {
    ctx.addIssue({ code: "custom", path: ["bends"], message: "Bend IDs must be unique within a draft." });
  }
  const stepIds = content.steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    ctx.addIssue({ code: "custom", path: ["steps"], message: "Step IDs must be unique within a draft." });
  }
  for (const [index, step] of content.steps.entries()) {
    if (!bendIds.includes(step.bendId)) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "bendId"], message: "Each step must refer to a bend in the same draft." });
    }
  }
});
export type DraftContent = z.infer<typeof DraftContentSchema>;

// Request schemas omit authority-bearing fields. They are strict so callers
// cannot smuggle reviewed flags, decision actors, review records, or resolved
// finding metadata through draft.save.
const FindingInputSchema = FindingFieldsSchema.omit({ disposition: true, resolutionRecordId: true });
const MachineProposalInputSchema = MachineProposalFieldsSchema.omit({ status: true, decidedBy: true });

export const DraftContentInputSchema = z.object({
  sourceAssetIds: z.array(IdSchema),
  workshopSnapshotId: IdSchema,
  machineId: IdSchema,
  panelModel: PanelModelInputSchema.nullable(),
  bends: z.array(BendSchema),
  steps: z.array(StepSchema),
  findings: z.array(FindingInputSchema),
  machineProposals: z.array(MachineProposalInputSchema),
}).strict().superRefine((content, ctx) => {
  const bendIds = content.bends.map((bend) => bend.bendId);
  if (new Set(bendIds).size !== bendIds.length) {
    ctx.addIssue({ code: "custom", path: ["bends"], message: "Bend IDs must be unique within a draft." });
  }
  const stepIds = content.steps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    ctx.addIssue({ code: "custom", path: ["steps"], message: "Step IDs must be unique within a draft." });
  }
  for (const [index, step] of content.steps.entries()) {
    if (!bendIds.includes(step.bendId)) {
      ctx.addIssue({ code: "custom", path: ["steps", index, "bendId"], message: "Each step must refer to a bend in the same draft." });
    }
  }
});
export type DraftContentInput = z.infer<typeof DraftContentInputSchema>;

export const DraftSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  version: z.number().int().positive(),
  content: DraftContentSchema,
  reviews: z.array(ReviewSchema),
  generationId: IdSchema.nullable(),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().superRefine((draft, ctx) => {
  const kinds = draft.reviews.map((review) => review.kind);
  if (new Set(kinds).size !== kinds.length) {
    ctx.addIssue({ code: "custom", path: ["reviews"], message: "A draft can have at most one current review of each kind." });
  }
  draft.reviews.forEach((review, index) => {
    if (review.draftVersion !== draft.version) {
      ctx.addIssue({ code: "custom", path: ["reviews", index, "draftVersion"], message: "Review must match the current draft version." });
    }
  });
});
export type Draft = z.infer<typeof DraftSchema>;

export const JobSchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  title: nonEmptyString,
  partNumber: nonEmptyString,
  partFamily: nonEmptyString,
  version: z.number().int().positive(),
  workshopSnapshotId: IdSchema.nullable(),
  machineId: IdSchema.nullable(),
  sourceAssetIds: z.array(IdSchema),
  draftId: IdSchema.nullable(),
  latestReleaseId: IdSchema.nullable(),
  createdAt: utcTimestamp,
}).strict();
export type Job = z.infer<typeof JobSchema>;

export const ReleaseSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  revisionNumber: z.number().int().positive(),
  snapshot: DraftContentSchema,
  sourceDraftVersion: z.number().int().positive(),
  reviews: z.array(ReviewSchema),
  publishedAt: utcTimestamp,
  publishedBy: IdSchema,
  supersedesReleaseId: IdSchema.nullable(),
  allowPredecessorVisitors: z.boolean(),
}).strict();
export type Release = z.infer<typeof ReleaseSchema>;

export const ReleaseViewSchema = z.object({
  job: JobSchema,
  release: ReleaseSchema,
  sourceAssets: z.array(AssetSchema),
  replacementReleaseId: IdSchema.nullable(),
  canFollowReplacement: z.boolean(),
  actor: ActorSchema,
  permissions: z.object({ canAsk: z.boolean(), canFlag: z.boolean(), canRespond: z.boolean() }).strict(),
}).strict().superRefine((view, ctx) => {
  if (view.job.id !== view.release.jobId) {
    ctx.addIssue({ code: "custom", path: ["release", "jobId"], message: "The release must belong to the displayed job." });
  }
  const expectedIds = view.release.snapshot.sourceAssetIds;
  const actualIds = view.sourceAssets.map((asset) => asset.id);
  if (new Set(expectedIds).size !== expectedIds.length ||
      new Set(actualIds).size !== actualIds.length ||
      expectedIds.length !== actualIds.length ||
      expectedIds.some((assetId) => !actualIds.includes(assetId))) {
    ctx.addIssue({ code: "custom", path: ["sourceAssets"], message: "Release view source assets must exactly match its immutable sourceAssetIds." });
  }
  view.sourceAssets.forEach((asset, index) => {
    if (asset.jobId !== view.release.jobId || asset.releaseId !== null || asset.kind === "issue_photo") {
      ctx.addIssue({ code: "custom", path: ["sourceAssets", index], message: "Release source assets must be source assets belonging to the same job." });
    }
    if (asset.status !== "ready" || asset.sha256 === null) {
      ctx.addIssue({ code: "custom", path: ["sourceAssets", index], message: "Published release source assets must be ready and have server-verified hashes." });
    }
  });
});
export type ReleaseView = z.infer<typeof ReleaseViewSchema>;

export const ContextRefSchema = z.object({
  jobId: IdSchema,
  releaseId: IdSchema.nullable(),
  draftId: IdSchema.nullable(),
  draftVersion: z.number().int().positive().nullable(),
  stepId: IdSchema.nullable(),
  bendId: nonEmptyString.nullable(),
}).strict().superRefine((context, ctx) => {
  const hasRelease = context.releaseId !== null;
  const hasDraft = context.draftId !== null;
  if (hasRelease === hasDraft) {
    ctx.addIssue({ code: "custom", path: ["releaseId"], message: "Context must identify exactly one release or draft." });
  }
  if ((hasDraft && context.draftVersion === null) || (hasRelease && context.draftVersion !== null)) {
    ctx.addIssue({ code: "custom", path: ["draftVersion"], message: "Draft contexts require a version; release contexts must not include one." });
  }
});
export type ContextRef = z.infer<typeof ContextRefSchema>;

export const AnswerSchema = z.object({
  id: IdSchema,
  context: ContextRefSchema,
  evidenceState: EvidenceStateSchema,
  text: nonEmptyString,
  evidence: z.array(EvidenceRefSchema),
  suggestedFlag: z.string().nullable(),
}).strict();
export type Answer = z.infer<typeof AnswerSchema>;

const FlagResponseSchema = z.object({
  text: nonEmptyString,
  authorId: IdSchema,
  at: utcTimestamp,
  kind: z.enum(["explanation", "replacement_release"]),
  replacementReleaseId: IdSchema.nullable(),
}).strict().superRefine((response, ctx) => {
  if ((response.kind === "replacement_release") !== (response.replacementReleaseId !== null)) {
    ctx.addIssue({ code: "custom", path: ["replacementReleaseId"], message: "Replacement responses require a release ID; explanations cannot carry one." });
  }
});

export const FlagSchema = z.object({
  id: IdSchema,
  context: ContextRefSchema,
  question: nonEmptyString,
  photoAssetIds: z.array(IdSchema),
  createdBy: ActorSchema,
  version: z.number().int().positive(),
  status: z.enum(["open", "responded", "resolved"]),
  createdAt: utcTimestamp,
  response: FlagResponseSchema.nullable(),
}).strict().superRefine((flag, ctx) => {
  if ((flag.status === "open") !== (flag.response === null)) {
    ctx.addIssue({ code: "custom", path: ["response"], message: "Open flags have no response; responded or resolved flags require one." });
  }
  if (flag.context.releaseId === null) {
    ctx.addIssue({ code: "custom", path: ["context"], message: "Flags are bound to a published release." });
  }
});
export type Flag = z.infer<typeof FlagSchema>;

export const GenerationSchema = z.object({
  id: IdSchema,
  jobId: IdSchema,
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  state: z.enum(["running", "succeeded", "failed", "expired"]),
  startedAt: utcTimestamp,
  expiresAt: utcTimestamp,
  draftVersion: z.number().int().positive().nullable(),
  errorCode: z.string().nullable(),
}).strict().superRefine((generation, ctx) => {
  if ((generation.state === "succeeded") !== (generation.draftVersion !== null)) {
    ctx.addIssue({ code: "custom", path: ["draftVersion"], message: "Only successful generations have a resulting draft version." });
  }
  if ((generation.state === "failed") !== (generation.errorCode !== null)) {
    ctx.addIssue({ code: "custom", path: ["errorCode"], message: "Failed generations include an error code; other states do not." });
  }
});
export type Generation = z.infer<typeof GenerationSchema>;

function polygonArea(polygon: Vec2[]) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function orientation(a: Vec2, b: Vec2, c: Vec2) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Vec2, b: Vec2, point: Vec2) {
  return Math.abs(orientation(a, b, point)) < 1e-8 &&
    point[0] >= Math.min(a[0], b[0]) - 1e-8 && point[0] <= Math.max(a[0], b[0]) + 1e-8 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-8 && point[1] <= Math.max(a[1], b[1]) + 1e-8;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (Math.abs(o1) < 1e-8 && onSegment(a, b, c)) ||
    (Math.abs(o2) < 1e-8 && onSegment(a, b, d)) ||
    (Math.abs(o3) < 1e-8 && onSegment(c, d, a)) ||
    (Math.abs(o4) < 1e-8 && onSegment(c, d, b));
}

function hasSelfIntersection(polygon: Vec2[]) {
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) return true;
    }
  }
  return false;
}

function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function segmentFollowsPolygonEdge(start: Vec2, end: Vec2, polygon: Vec2[], tolerance: number) {
  return polygon.some((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return distanceToSegment(start, point, next) <= tolerance && distanceToSegment(end, point, next) <= tolerance;
  });
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-16) return distance(point, start);
  const projection = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + projection * dx), point[1] - (start[1] + projection * dy));
}

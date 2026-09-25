/** Runtime DTOs and inferred types are authoritative in contract v1.0. */
export type {
  Actor,
  Asset,
  Bend,
  ContextRef,
  Draft,
  DraftContent,
  DraftContentInput,
  EvidenceRef,
  Finding,
  Flag,
  Generation,
  Hinge,
  Id,
  Job,
  Machine,
  MachineProposal,
  Panel,
  PanelModel,
  Release,
  Review,
  Role,
  Step,
  WorkshopSnapshot,
} from "@/contracts/domain";

export type DomainPersistence<TTransaction> = {
  /** Must commit the callback's writes atomically or leave no writes behind. */
  transaction<T>(work: (transaction: TTransaction) => Promise<T>): Promise<T>;
};

# Request 0003 — keep editable schemas composable at runtime

- Target owner: the `src/contracts/**` implementer (TEAM-2 contract lane).
- Affected file: `src/contracts/domain.ts` around `FindingInputSchema` and `MachineProposalInputSchema`.
- Observed failure: importing contracts at runtime throws Zod 4 `.omit() cannot be used on object schemas containing refinements` because the input schemas are derived from already-refined `FindingSchema` and `MachineProposalSchema`.
- Requested change: define reusable unrefined object bases for those DTOs, apply `.omit()` to the bases, and attach the cross-field `superRefine` checks to the final runtime schemas. Preserve the current strict request shapes and authority-field rejection.
- Validation: run `npm test -- --run tests/contracts/schemas.test.ts tests/backend/http/api.test.ts tests/backend/ai` and `npm run typecheck`.
- Status: resolved in the contract milestone commit after deriving editable input schemas from their unrefined object bases. `npm test` now passes 9 files and 66 tests, including contract runtime parsing.

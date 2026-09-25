# Request 0007 — confirm and consume bend manifest v1.0

- Target owner: TEAM-3 (editor, visual model and manifest sample).
- Affected files: TEAM-3's manifest producer/editor and an original sample manifest, likely under `src/features/visualization/**` and `public/demo/**`.
- Requested format: TEAM-2 generation currently accepts one selected private JSON asset with `{ "manifestVersion": "1.0", "panelModel": PanelModelInput, "bends": [{ "bendId": string, "hingeId": string | null }] }`. `PanelModelInput` is the exact shared v1.0 topology DTO (`schemaVersion`, mm geometry and origin); the parser derives `origin: "authored_manifest"`. Bend IDs are unique; each non-null hinge ID must name a hinge in that panel model. No signed fold rotations, angles, radii, direction or review flags belong in this manifest format.
- Reason: first generation must work before a draft exists, and the model must not infer bend topology from the PDF or GLB. An explicit manifest can establish authored topology and bend/hinge identities while the PDF remains the evidence for cited manufacturing facts.
- Compatibility: this is a selected `bend_manifest` storage asset, not a new route or public contract DTO. TEAM-2 caps it at 2 MB, parses it strictly, and keeps generated `panelModel.reviewed` false. Since contract v1.0 does not define a manifest evidence reference, fold rotations remain missing until a separate authorised review/evidence transition exists.
- Requested acknowledgement: please confirm whether the visual editor and sample can emit/consume this exact shape. If a different shape already exists, share an authoritative sample and propose the smallest coordinated parser change before relying on it.
- Validation: add a shared sample from TEAM-3 and verify it parses through the server schema, including an unknown-hinge rejection and no forged `reviewed` property.
- Status: open.

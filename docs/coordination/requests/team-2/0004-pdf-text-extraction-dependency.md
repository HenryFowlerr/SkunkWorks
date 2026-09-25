# Request 0004 — add trusted server-side PDF text extraction

- Target owner: TEAM-1 (package manifest, lockfile and deployment bundling).
- Affected files: `package.json`, `package-lock.json` and any Next.js server bundling configuration required by the pinned dependency.
- Requested dependency: pin `pdfjs-dist` to `6.3.289` so TEAM-2 can extract page text from verified uploaded PDF bytes before generation and validate model citations against exact source text. Use the official Node example import `pdfjs-dist/legacy/build/pdf.mjs`; no browser bundle is needed for this backend operation.
- Reason: AI output must cite an allowlisted asset and page, and each excerpt must be checked against trusted text from that uploaded PDF. Passing a PDF to a model without a trusted extractor would make excerpt validation self-reported.
- Compatibility: server-only dependency; no public contract change. Confirm it works in the pinned Node/Next runtime and does not enter client bundles.
- Evidence: Mozilla's Node example imports the legacy build and calls `getTextContent()` per page: [official example](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs). The current package version is listed as 6.3.289: [npm package](https://www.npmjs.com/package/pdfjs-dist).
- Validation: install and lock the exact version, then build and test extraction from an original sample PDF with page numbering preserved. If local registry access is unavailable, record that environment limit; do not add an unpinned or substitute parser.
- Status: open.

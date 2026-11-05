# GenOffice DOCX engine extraction

Upstream: https://github.com/genspark-ai/genoffice

Fixed commit: `953595e2f1635140e2a6c1f86c2fa12b0cca77b8`.
Source: `packages/docx-engine/src/`; geometry is limited to `packages/pptx-engine/src/custgeom.ts` and its three-field `CustomGeometry` type.
License: Apache-2.0. Original GenOffice LICENSE/NOTICE are retained by the Office resource manifest. The nested emf-converter 2.0.2 Apache-2.0 license and upstream modification README remain beside its bundle.

This is an actual upstream engine extraction, not a replacement paragraph editor. Parsing, raw OOXML anchors, styles, tables, images, charts, notes, sections, fonts and structural `saveDocx` are retained. GenOffice Electron shells, AI providers, account state, network model loops and application stores are not imported.

## Local changes

- Resolve the sole PPTX custom-geometry dependency to the sibling pure geometry extraction.
- Preserve the upstream optional-property runtime contract explicitly as `T | undefined`. Indexed/capture values required by the algorithms are checked by `requiredValue`; malformed inputs fail instead of relying on unchecked access. Dead locals are removed. No compiler exclusions, `@ts-ignore`, `@ts-nocheck` or global strictness changes are used.
- Follow the repository formatter and lint rules. emf-converter changes are limited to unused parameters/dead expressions and equivalent nullish assignment; its drawing algorithm is retained.
- Rename local XML entity-unescaping helpers in generate.ts, ink.ts and resource-cleanup.ts to `unescapeXmlText`/`unescapeXmlEntities` for the source naming guard. Implementations and call behavior are unchanged; companion local hashes are refreshed while upstream hashes remain fixed.
- ZIP input is limited to 64 MiB; each expanded part to 64 MiB, aggregate to 64 MiB, and entries to 2048. This removes Seal's earlier 8 MiB compressed-file gate while retaining the bounded ZIP expansion policy. Central-directory duplicate/traversal/encryption/unsupported compression checks run before JSZip name normalization. Every actual part stream is bounded and CRC-checked, including no-op input, before XML parsing; verified bytes are cached for subsequent reads.
- TIFF decoding uses bounded OffscreenCanvas encoding in a dedicated Worker. Unsupported canvas or decoding fails explicitly. Metafile conversion uses the existing OffscreenCanvas implementation with bounded canvas/record options and reports failure instead of returning an empty frame.
- Save-plan runtime validation is generated from the full `SaveBlock`/`SaveOptions` type graph (`save-plan-shape.json`), with bounded recursive validation, including numeric index signatures. From the repository root, run `node scripts/office/generate-save-plan-shape.mjs --check` for a read-only JSON semantic comparison; omit `--check` only to explicitly regenerate after reviewing type changes. The generator rejects unsupported types rather than widening the contract. The Worker message schema uses Zod jitless mode before construction. The supervisor owns deadline/cancel/terminate; only document projections leave the Worker, not original archive bytes or private parse anchors.

## Large upstream files and remaining boundaries

The upstream engine contains large coupled modules (notably parse, generate, patch, types and math). They remain in the corresponding renderer vendor directory under the repository's vendor size rule (engineering structure S3); this is not a promotion into first-party modules. Any later promotion requires dependency-aware splitting. Local adaptations and original/current hashes are recorded in the companion provenance JSON; no file is asserted byte-identical after modification.

The worker/client tests establish termination and envelope behavior. DOCX tests establish the tested OOXML operations and byte preservation, not universal Word compatibility or desktop installed-app acceptance. EMF/WMF complex drawing approximations described by the upstream README remain; browser-level glyph, canvas and IME acceptance belongs to the integrated editor validation. Heavy ZIP/XML computation is reachable through the dedicated Worker only from the Office UI.

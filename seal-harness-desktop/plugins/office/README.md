# Local Office core

Apache GenOffice source subset pinned in vendor/genoffice/provenance.json; no ee or original desktop app. Provides a local structured editing surface for DOCX/XLSX/PPTX. Native recalculation, original WYSIWYG editors, PDF/pixel rendering and AI providers are not included. These are explicit capability limits, not licensed features silently activated later. New revisions preserve imported originals. Files stay in this product/account; no background file scanning, telemetry, cloud service or provider key is configured.

Runtime needs existing Electron/Node24 and the generated core CJS bundle. Build with scripts/build-core.mjs. The source contains no fonts; display uses the product/system fonts. Core retains Apache LICENSE/NOTICE; production build collects exact dependency license texts. JSZip uses its MIT option.

## Supported operations and boundaries

Open the product's **办公文档** page after local login. Create a DOCX from paragraphs, an XLSX from CSV, or a PPTX from text sections separated by a standalone `---` line (at most 50 slides). Import `.docx`, `.xlsx` and `.pptx`, edit supported text/cells, then export the new revision. Input files are limited to 8 MB. The preview exposes at most 300 blocks; other content remains in the source file. This is a structured text preview, not a page or slide renderer.

DOCX editing targets ordinary paragraphs/headings/list items; PPTX editing targets top-level text boxes/shapes. Replaced text uses the first run's formatting. Complex objects are not exposed as a full editing surface. Documents declaring editing protection are read-only here. XLSX formulas are stored for a compatible spreadsheet application to recalculate. Long integer identifiers, leading zeros and overflowing numbers remain text during editing. No macro or embedded document code is executed.

Storage is scoped by the product namespace and local account. Import transfers the selected file over the existing product connection to the device running the product; it does not call GenOffice or an AI provider. Every save creates a new revision and preserves the imported original. No user profile, keys or documents are included in the build. No native Office installation is required by this subset.

The installer file rules include this plugin's generated `lib/**` and license notices. Validation currently covers the assembled plugin directory and isolated profiles, not a completed installer on a fresh machine. See `.trellis/tasks/11-03-genoffice-core/implement.md` for the recorded checks.

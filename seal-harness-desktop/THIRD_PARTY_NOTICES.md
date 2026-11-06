# Third-Party Notices

## WeKnora DSH plugin 0.1.0

Source: https://www.npmjs.com/package/@wxg-prc-cpg/dsh-weknora, MIT license.
The local `@seal-harness/weknora` plugin is adapted from the official WeKnora plugin in Tencent/WeKnora. Its original license and source provenance are kept in `plugins/weknora/` and copied into the packaged plugin.

## cc-haha capability catalog and official CLI adapters

Source: https://github.com/NanmiCoder/cc-haha, commit `0a3b549d5ec020569d766a7c16ce209c6110af51`.

The connector catalog, skill catalog snapshot, connector SVG resources, and managed CLI adapters are adapted from cc-haha under its MIT license. The complete original license and adaptation notes are preserved in `plugins/capability-shared/vendor/cc-haha/` and copied into the packaged connectors/skills plugins. Original file hashes and pinned third-party skill file checksums are preserved in `plugins/capability-shared/catalog/`.

Third-party service names and logos identify their respective services and rights holders. Skill package licenses, authors and source revisions remain attached to each installed package; the MIT license of cc-haha does not replace the separate licenses of those packages.

## MCP for Blender icon

The Blender MCP catalog icon is copied from `ahujasid/mcp-for-blender`, commit `992233bb258975a05eec8b5691465c50c2831e34`, `integrations/codex/plugins/mcp-for-blender/assets/logo.png`. Its original SHA256 and source URL are recorded in `plugins/capability-shared/catalog/blender-icon.json`.

MIT License

Copyright (c) 2025 Siddharth Ahuja

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## morphicons 1.7.0

MIT License

Copyright (c) 2026 Guillermo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
## Cua Driver 0.38.0

电脑操作插件分发 Cua Driver 基础驱动，来源 https://github.com/trycua/cua ，发布标签 `cua-driver-rs-v0.38.0`（上游标记 prerelease），源码提交 `85e2b1318bd77ccf3cfa88ccdf875a4bb7eaed19`。MIT 许可证原文见 `plugins/computer-use/assets/CUA-LICENSE.txt`，随包也保留在驱动 runtime 目录。固定资产 SHA256、平台与构建来源记录在该插件的 driver-manifest/provenance 中。不包含 Cua Spaces、Lume、云服务或可选 AGPL 的 cua-perception 扩展。

## GenOffice Apache core

Selected document engines from https://github.com/genspark-ai/genoffice, commit e1f50e90d246f3ecc6427d2a0af90f04f37810ec. Copyright 2026 Mainfunc, Inc., Apache-2.0. No ee, original desktop app, fonts, AI providers or Rust sidecar is included. Packaging and local structured editing adapter are modified by this product.

The Office plugin ships original LICENSE/NOTICE and exact dependency notices under lib/third-party/genoffice. JSZip uses its MIT option; pako retains both MIT and original Zlib notices. No GenOffice affiliation or trademark grant is implied.

## Stratex Word workspace adapter

The independent workspace Word editor follows Stratex's DOCX editing adapter and bundles its browser-safe GenOffice extraction from commit `953595e2f1635140e2a6c1f86c2fa12b0cca77b8` (Apache-2.0). Its LICENSE, NOTICE, source record and modification provenance ship under `@seal-harness/workspace-word/lib/third-party/genoffice-stratex/`. This editor works on a file in the active DSH workspace; the Office document library above retains separate account-scoped files and revisions.

## XLSX and PPTX visual previews

The workspace spreadsheet and presentation previews use `@silurus/ooxml` 0.75.5 (MIT), following Stratex's Worker and Canvas preview integration. The published package, including its LICENSE and THIRD_PARTY_NOTICES.md, ships with `@seal-harness/workspace-word`; Seal serves its ESM and WASM assets locally without modification. Source: https://github.com/yukiyokotani/office-open-xml-viewer.

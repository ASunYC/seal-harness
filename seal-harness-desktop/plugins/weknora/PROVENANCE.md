# WeKnora DSH plugin provenance

- Published package: `@wxg-prc-cpg/dsh-weknora@0.1.0`
- npm tarball: `https://registry.npmjs.org/@wxg-prc-cpg/dsh-weknora/-/dsh-weknora-0.1.0.tgz`
- npm integrity: `sha512-L6q32rNrDBU3Q8xE0SGYMlieC8sKswrp5GOslGka4UnH+f4boxLXLLMgkceE+Ub/c+C2tQ2rsaHXky9bO3pXlw==`
- Source repository: `https://github.com/Tencent/WeKnora`, `packages/dsh-weknora/`
- License: MIT; the upstream root LICENSE is included here.

The six `upstream/*.js` files are copied without modification from the published npm tarball's `dist/` directory. Seal Harness copies them under `lib/upstream/` in a product-owned package named `@seal-harness/weknora`. Its Host wrapper reads the service URL and API Key from the DSH Host credential store, with environment defaults from the product Cordis patch; no credential is embedded in the package.

`upstream-sha256.json` records each published JavaScript file's digest and is checked by the product test.

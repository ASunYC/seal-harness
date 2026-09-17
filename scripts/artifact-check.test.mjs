import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPublicAssets } from "../apps/desktop/scripts/artifact-check.mjs";
import { packageTargets } from "../apps/desktop/scripts/package-targets.mjs";

test("selects actual platform binaries without disabling the Electron sandbox", () => {
  const windows = packageTargets("repo", "0.3.4", "win32");
  assert.equal(windows.targets.length, 2);
  assert.ok(windows.targets[1][1].SEAL_DESKTOP_BINARY.endsWith("Seal-Harness-Portable-0.3.4.exe"));
  const linux = packageTargets("repo", "0.3.4", "linux");
  assert.equal(linux.targets.length, 1);
  assert.ok(linux.targets[0][1].SEAL_DESKTOP_BINARY.endsWith("Seal-Harness-0.3.4-x64.AppImage"));
  assert.equal(linux.targets[0][1].APPIMAGE_EXTRACT_AND_RUN, "1");
  assert.deepEqual(Object.keys(linux.targets[0][1]).sort(), ["APPIMAGE_EXTRACT_AND_RUN", "SEAL_DESKTOP_BINARY"]);
  assert.throws(() => packageTargets("repo", "0.3.4", "darwin"), /Unsupported/);
  assert.throws(() => packageTargets("repo", "0.3.4", "linux", "arm64"), /Unsupported/);
});

test("checks nested assets, changed content and unexpected packaged files", async () => {
  const root = await mkdtemp(join(tmpdir(), "seal-artifact-test-"));
  const source = join(root, "source"), packed = join(root, "packed");
  try {
    for (const dir of [source, packed]) {
      await mkdir(join(dir, "icons"), { recursive: true });
      await writeFile(join(dir, "icons/seal.svg"), "same");
    }
    const report = await verifyPublicAssets(source, packed);
    assert.equal(report["icons/seal.svg"].bytes, 4);
    assert.match(report["icons/seal.svg"].sha256, /^[a-f0-9]{64}$/);
    await writeFile(join(packed, "icons/seal.svg"), "stale");
    await assert.rejects(verifyPublicAssets(source, packed), /Stale packaged UI: icons\/seal.svg/);
    await assert.rejects(verifyPublicAssets(source, packed, "runtime-pi"), /Stale packaged runtime-pi: icons\/seal.svg/);
    await writeFile(join(packed, "icons/seal.svg"), "same");
    await writeFile(join(packed, "obsolete.js"), "old");
    await assert.rejects(verifyPublicAssets(source, packed), /inventory differs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

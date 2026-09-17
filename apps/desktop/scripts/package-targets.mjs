import { join } from "node:path";

export function packageTargets(root, version, platform, arch = "x64") {
  if (arch !== "x64" || !["win32", "linux"].includes(platform)) throw new Error(`Unsupported packaged verification target: ${platform}/${arch}`);
  const output = join(root, ".artifacts/desktop");
  return platform === "win32" ? {
    resources: join(output, "win-unpacked/resources"),
    targets: [
      ["unpacked", { SEAL_DESKTOP_BINARY: join(output, "win-unpacked/Seal Harness.exe") }],
      ["portable", { SEAL_DESKTOP_BINARY: join(output, `Seal-Harness-Portable-${version}.exe`) }],
    ],
  } : {
    resources: join(output, "linux-unpacked/resources"),
    targets: [["appimage", { SEAL_DESKTOP_BINARY: join(output, `Seal-Harness-${version}-x64.AppImage`), APPIMAGE_EXTRACT_AND_RUN: "1" }]],
  };
}

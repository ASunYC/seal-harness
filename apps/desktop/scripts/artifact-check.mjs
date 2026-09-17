import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function fingerprint(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const info = await stat(path);
  return { bytes: info.size, sha256: hash.digest("hex") };
}

export async function verifyPublicAssets(source, packed, label = "UI") {
  async function files(root, prefix = "") {
    const found = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) found.push(...await files(root, name));
      else if (entry.isFile()) found.push(name);
      else throw new Error(`Unsupported public asset: ${name}`);
    }
    return found.sort();
  }
  const expected = await files(source);
  const actual = await files(packed);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Packaged ${label} file inventory differs; run pnpm desktop:dist`);
  const assets = {};
  for (const file of expected) {
    const original = await fingerprint(join(source, file));
    const bundled = await fingerprint(join(packed, file));
    if (original.sha256 !== bundled.sha256) throw new Error(`Stale packaged ${label}: ${file}; run pnpm desktop:dist`);
    assets[file] = bundled;
  }
  return assets;
}

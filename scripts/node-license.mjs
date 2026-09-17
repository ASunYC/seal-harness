import { setTimeout as delay } from "node:timers/promises";

/** Fail closed: a release must include the license for its bundled Node version. */
export async function downloadNodeLicense(version, { fetchImpl = fetch, sleep = delay, warn = console.warn } = {}) {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unsupported Node release version: ${version}`);
  const rawUrl = `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`;
  const apiUrl = `https://api.github.com/repos/nodejs/node/contents/LICENSE?ref=${version}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Same upstream file and version; the API route also works on networks
    // where raw.githubusercontent.com is unreachable. Never use a mirror/latest.
    const url = attempt === 1 ? rawUrl : apiUrl;
    let retryable = true;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(30_000), headers: { Accept: "application/vnd.github.raw+json" },
      });
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const license = await response.text();
      if (!license.startsWith("Node.js is licensed for use as follows:")) throw new Error("Unexpected Node license response");
      return license;
    } catch (cause) {
      if (!retryable || attempt === 3) {
        throw new Error(`Could not download required Node.js ${version} license after ${attempt} attempt(s): ${url}`, { cause });
      }
      warn(`Node.js license download attempt ${attempt}/3 failed; retrying: ${cause.message}`);
      await sleep(attempt * 1000);
    }
  }
}

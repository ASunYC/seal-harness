import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const host = await import(pathToFileURL(resolve("apps/desktop/src/host.mjs")).href);
describe("desktop navigation boundaries", () => {
  it("permits only the backend origin", () => {
    expect(host.isLocalNavigation("http://127.0.0.1:8080/?token=test", "http://127.0.0.1:8080")).toBe(true);
    for (const url of ["http://127.0.0.1:8081/", "https://example.com", "file:///C:/secret", "http://user@127.0.0.1:8080/"]) {
      expect(host.isLocalNavigation(url, "http://127.0.0.1:8080")).toBe(false);
    }
  });
  it("never passes executable protocols or embedded credentials to the OS", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/x", "ms-settings:privacy", "https://user:pass@example.com", "not a URL"]) expect(host.externalUrl(url)).toBeUndefined();
    expect(host.externalUrl("https://github.com/vastsa/PI-Desktop")).toBe("https://github.com/vastsa/PI-Desktop");
  });
});

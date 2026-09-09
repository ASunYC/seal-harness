import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/session-export.js")).href;

describe("session log export", () => {
  it("requests the complete descendant tree", async () => {
    const { sessionLogExportUrl } = await import(moduleUrl);
    expect(sessionLogExportUrl("parent/child ?")).toBe("/api/session.export?sessionId=parent%2Fchild+%3F&includeDescendants=true");
  });

  it("uses the official filesystem-safe archive name", async () => {
    const { sessionLogZipFilename } = await import(moduleUrl);
    expect(sessionLogZipFilename("parent/child:one")).toBe("dsh-session-parent_child_one.zip");
  });
});

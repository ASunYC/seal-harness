import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "apps/web/public/context-message.js")).href;

describe("context message classification", () => {
  it("leaves actual user messages in the ordinary bubble path", async () => {
    const { contextMessageModel } = await import(moduleUrl); expect(contextMessageModel(undefined)).toBeNull(); expect(contextMessageModel({ kind: "user" })).toBeNull(); expect(contextMessageModel({ kind: "user-rpc" })).toBeNull();
  });

  it("projects relay, notice, and opaque plugin provenance", async () => {
    const { contextMessageModel } = await import(moduleUrl);
    expect(contextMessageModel({ kind: "agent-message", form: "relay", senderSessionId: "child" })).toEqual({ form: "relay", provenance: "From child", summary: "From child", structured: null });
    expect(contextMessageModel({ kind: "plugin", plugin: "repeat-tool-reminder", form: "notice", summary: "bash × 2" })).toEqual({ form: "notice", provenance: "repeat-tool-reminder", summary: "bash × 2", structured: null });
    expect(contextMessageModel({ kind: "plugin", plugin: "policy" })).toEqual({ form: "opaque", provenance: "policy", summary: null, structured: null });
    expect(contextMessageModel({ kind: "job-completion", jobId: "j1" })).toEqual({ form: "notice", provenance: "job-completion", summary: "Job j1 completed", structured: null });
  });

  it("validates structured forms all-or-nothing and bounds catalogs", async () => {
    const { contextStructuredBody } = await import(moduleUrl);
    expect(contextStructuredBody("instructions", { baseline: true, changes: [{ path: "AGENTS.md", action: "set" }, { path: "AGENTS.md", action: "replace" }] })).toEqual({ kind: "instructions", baseline: true, changes: [{ path: "AGENTS.md", action: "set" }] });
    expect(contextStructuredBody("snapshot", { sections: [{ name: "Policy", text: "active" }] })).toEqual({ kind: "snapshot", sections: [{ name: "Policy", text: "active" }] });
    expect(contextStructuredBody("recall", { references: [{ label: "Prior", retainedMessages: 2, omittedMessages: 1, truncated: true }] })).toEqual({ kind: "recall", references: [{ label: "Prior", retained: 2, omitted: 1, truncated: true }] });
    expect(contextStructuredBody("recall", { references: [{ label: "Broken" }] })).toBeNull();
    const catalog = contextStructuredBody("catalog", { entries: Array.from({ length: 202 }, (_, index) => ({ name: `s${index}`, description: "skill" })) }); expect(catalog.entries).toHaveLength(200); expect(catalog.omitted).toBe(2);
  });
});

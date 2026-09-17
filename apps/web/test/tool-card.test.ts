// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { toolCardModel, createToolCard } = await import(pathToFileURL(resolve("apps/web/public/tool-card.js")).href);
describe("native tool cards", () => {
  it("shows bounded partial snapshots without completing or reopening the tool", () => {
    const card=createToolCard({name:'shell',arguments:{command:'build'}},'en',document);
    card.progress([{type:'text',text:'first'}]);
    const pre=card.root.querySelector('.tool-progress pre');
    card.progress([{type:'text',text:'first\n<script>second</script>'}]);
    expect(card.root.dataset.phase).toBe('running');expect(card.root.open).toBe(false);
    expect(card.root.querySelector('.tool-progress pre')).toBe(pre);
    expect(pre.textContent).toBe('first\n<script>second</script>');expect(card.root.querySelector('script')).toBeNull();
    card.progress([{type:'text',text:'line\n'.repeat(500)}]);
    expect(pre.textContent.split('\n')).toHaveLength(400);
    expect(card.root.querySelector('.tool-progress .semantic-tool-limit').hidden).toBe(false);
    card.update({isError:true,content:[{type:'text',text:'build failed'}]});
    card.progress([{type:'text',text:'late progress'}]);
    expect(card.root.dataset.phase).toBe('error');expect(card.root.querySelector('.tool-progress')).toBeNull();
    expect(card.root.textContent).toContain('build failed');expect(card.root.textContent).not.toContain('late progress');
  });
  it("groups search hits by file and keeps line numbers and untrusted source text", () => {
    const card = createToolCard({ name: "search_text", arguments: { query: "x" } }, "en", document);
    card.update({ content: [{ type: "text", text: "C:\\src\\a.ts:12:<script>x</script>\nb.ts:3:x:4:y\nC:\\src\\a.ts:19:last" }] });
    expect(card.root.querySelectorAll(".search-match-file")).toHaveLength(2);
    expect(card.root.querySelectorAll(".search-match-line")).toHaveLength(3);
    expect(card.root.querySelector("h5").textContent).toBe("C:\\src\\a.ts");
    expect(card.root.querySelector("script")).toBeNull();
    expect(card.root.textContent).toContain("<script>x</script>");
    expect(card.root.textContent).toContain("x:4:y");
  });
  it("preserves malformed search output and errors instead of dropping diagnostic lines", () => {
    for (const isError of [true, false]) {
      const card = createToolCard({ name: "search_text", arguments: {} }, "en", document);
      const output = "a.ts:2:match\npermission denied";
      card.update({ isError, content: [{ type: "text", text: output }] });
      expect(card.root.querySelector(".search-match-file")).toBeNull();
      expect(card.root.querySelector("pre").textContent).toBe(output);
    }
  });
  it("caps grouped matches with an explicit remaining count", () => {
    const card = createToolCard({ name: "search_text", arguments: {} }, "en", document);
    card.update({ content: [{ type: "text", text: Array.from({ length: 230 }, (_, i) => `a.ts:${i + 1}:x`).join("\n") }] });
    expect(card.root.querySelectorAll(".search-match-line")).toHaveLength(200);
    expect(card.root.textContent).toContain("30 more matches");
  });
  it("separates command/stdout/stderr and avoids duplicate serialized output", () => {
    const model = toolCardModel({ name: "shell", arguments: { command: "pnpm test" } }, {
      isError: true, content: [{ type: "text", text: "serialized duplicate" }], details: { stdout: "passed", stderr: "failed", exitCode: 1 },
    }, "en");
    expect(model.phase).toBe("error"); expect(model.badges).toContain("Exit 1");
    expect(model.blocks.map((block: any) => block.content)).toEqual(["pnpm test", "passed", "failed"]);
  });
  it("labels requested edits honestly, not as verified file diffs", () => {
    const model = toolCardModel({ name: "replace_text", arguments: { path: "a.ts", oldText: "before", newText: "after" } }, { isError: true, content: [{ type: "text", text: "oldText was not found" }] }, "en");
    expect(model.phase).toBe("error"); expect(model.blocks[0].title).toContain("requested");
    expect(model.blocks[2].content).toBe("oldText was not found");
  });
  it("uses persisted metadata on replay and leaves unknown tools to their plugin", () => {
    expect(toolCardModel({ name: "custom-plugin", arguments: {} })).toBeUndefined();
    const model = toolCardModel({ name: "search_text", arguments: { query: "hello" } }, { meta: { count: 3, truncated: true }, content: [] }, "en");
    expect(model.badges).toEqual(["3 matches", "Result truncated"]);
  });
  it("merges a result into one accessible disclosure and renders untrusted output as text", () => {
    const card = createToolCard({ name: "read_file", arguments: { path: "test.html" } }, "en", document);
    document.body.append(card.root);
    card.root.open = true;
    card.update({ content: [{ type: "text", text: "<script>alert(1)</script>" }] });
    expect(card.root.dataset.phase).toBe("completed");
    expect(card.root.open).toBe(true);
    expect(card.root.querySelector("script")).toBeNull();
    expect(card.root.querySelector("pre").textContent).toBe("<script>alert(1)</script>");
    expect(card.root.querySelector("summary").textContent).toContain("Completed");
    card.root.remove();
  });
  it("bounds preview size without silently pretending the whole result is shown", () => {
    const card = createToolCard({ name: "read_file", arguments: {} }, "en", document);
    card.update({ content: [{ type: "text", text: "line\n".repeat(2000) }] });
    expect(card.root.querySelector("pre").textContent.split("\n")).toHaveLength(400);
    expect(card.root.textContent).toContain("session log");
  });
});

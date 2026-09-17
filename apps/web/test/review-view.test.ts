// @vitest-environment jsdom
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
const url = pathToFileURL(resolve(process.cwd(), "apps/web/public/review-view.js")).href;
const cards = pathToFileURL(resolve(process.cwd(), "apps/web/public/tool-card.js")).href;
describe("recorded review UI", () => {
  it("requires explicit confirmation, makes cancellation inert, and prevents duplicate submission", async () => {
    const { renderReviewSnapshot } = await import(url); const doc = (globalThis as any).document;
    let finish: any; const rollback = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const node = renderReviewSnapshot({ id: "s", before: null, after: "new", status: "applied", path: "new.txt" }, "en", doc, { rollback });
    const start = node.querySelector(".review-actions > button"); start.click();
    expect(node.textContent).toContain("Delete the newly created file new.txt");
    node.querySelector(".review-confirmation button").click(); expect(rollback).not.toHaveBeenCalled();
    start.click(); const confirm = node.querySelectorAll(".review-confirmation button")[1];
    const pending = confirm.onclick(); await confirm.onclick(); expect(rollback).toHaveBeenCalledTimes(1);
    finish({ outcome: "rolled-back" }); await pending; expect(node.querySelector('[role="status"]').textContent).toContain("rolled back");
    expect(node.querySelector(".review-actions button")).toBeNull();
  });
  it("keeps a conflict visible without showing success", async () => {
    const { renderReviewSnapshot } = await import(url); const doc = (globalThis as any).document;
    const node = renderReviewSnapshot({ id: "s", before: "old", after: "new", status: "applied", path: "a" }, "en", doc, { rollback: async () => { throw new Error("File changed"); } });
    node.querySelector(".review-actions > button").click(); const confirm = node.querySelectorAll(".review-confirmation button")[1];
    await confirm.onclick(); expect(node.querySelector('[role="alert"]').textContent).toBe("File changed");
    expect(node.querySelector('[role="status"]')).toBeNull(); expect(confirm.disabled).toBe(false);
  });
  it("preserves line identities and distinguishes new files", async () => {
    const { reviewLines } = await import(url);
    expect(reviewLines("a\nb\nc", "a\nx\nc").lines).toEqual([
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "b", oldLine: 2, newLine: null },
      { kind: "added", text: "x", oldLine: null, newLine: 2 },
      { kind: "context", text: "c", oldLine: 3, newLine: 3 },
    ]);
    expect(reviewLines(null, "new").lines[0].kind).toBe("added");
    expect(reviewLines("same", "same").lines).toEqual([]);
    expect(reviewLines("old", "x\n".repeat(1000)).truncated).toBe(true);
  });
  it("renders source as text and warns about post-write conflicts", async () => {
    const { renderReviewSnapshot } = await import(url);
    const node = renderReviewSnapshot({ before: null, after: "<script>bad</script>", status: "conflict", path: "x" });
    expect(node.querySelector("script")).toBeNull(); expect(node.querySelector('[role="alert"]')).not.toBeNull();
    expect(node.textContent).toContain("<script>bad</script>");
  });
  it("loads evidence on demand and keeps failures retryable", async () => {
    const { createToolCard } = await import(cards); const doc = (globalThis as any).document;
    const loadReview = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ before: "actual old", after: "actual new", status: "applied", path: "a" });
    const card = createToolCard({ name: "write_file", arguments: { path: "a", content: "request" } }, "en", doc, { loadReview });
    card.update({ content: [], details: { review: { available: true, snapshotId: "s" } } });
    expect(loadReview).not.toHaveBeenCalled(); const button = card.root.querySelector("button");
    await button.onclick(); expect(button.disabled).toBe(false); expect(card.root.textContent).toContain("unavailable");
    await button.onclick(); expect(card.root.querySelector(".review-evidence").textContent).toContain("actual new");
    expect(loadReview).toHaveBeenCalledWith("s"); expect(card.root.querySelector(".review-error")).toBeNull();
  });
});

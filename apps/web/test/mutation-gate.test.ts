import { describe, expect, it, vi } from "vitest";

import { createMutationGate } from "../public/mutation-gate.js";

describe("shared mutation gate", () => {
  it("admits only one mutation until settlement", () => {
    const changed = vi.fn(); const gate = createMutationGate(changed);
    expect(gate.tryLock()).toBe(true); expect(gate.tryLock()).toBe(false); expect(gate.pending()).toBe(true); expect(changed).toHaveBeenCalledTimes(1);
    gate.unlock(); expect(gate.pending()).toBe(false); expect(gate.tryLock()).toBe(true); expect(changed).toHaveBeenLastCalledWith(true);
  });

  it("does not publish redundant unlocks", () => {
    const changed = vi.fn(); const gate = createMutationGate(changed); gate.unlock(); expect(changed).not.toHaveBeenCalled();
  });
});

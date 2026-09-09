import type { TeamService } from "@seal-harness/core";
import { describe, expect, it } from "vitest";
import { definitions } from "../src/index.js";

describe("Agent Team tools", () => {
  it("publishes the exact nine-tool DeepSeek Harness catalog", () => {
    const tools = definitions({} as TeamService);
    expect(tools.map(tool => tool.name)).toEqual([
      "spawn_teammate", "send_message", "list_agents", "wait_agent", "interrupt_agent",
      "team_task_create", "team_task_list", "team_task_get", "team_task_update",
    ]);
  });
});

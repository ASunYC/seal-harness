import {
  agentServiceToken,
  goalServiceToken,
  sessionStoreToken,
  type GoalRef,
  type GoalView,
  type ModelRef,
  type SealHarnessEvents,
  type SessionId,
  type SessionSnapshot,
} from "@seal-harness/core";
import { definePlugin } from "@seal-harness/kernel";

export const goalRoundDriverPlugin = definePlugin<Record<string, never>, SealHarnessEvents>({
  name: "goal-round-driver",
  requires: [agentServiceToken, goalServiceToken, sessionStoreToken],
  setup(context) {
    const agents = context.use(agentServiceToken);
    const goals = context.use(goalServiceToken);
    const sessions = context.use(sessionStoreToken);
    const driving = new Set<SessionId>();
    let stopped = false;

    context.effect(context.on("session.appended", ({ sessionId, events }) => {
      if (stopped || !events.some(entry => entry.event.type === "run.completed")) return;
      queueMicrotask(() => { if (!stopped) void drive(sessionId); });
    }));
    context.effect(async () => {
      stopped = true;
      const snapshots = await sessions.list();
      await Promise.all(snapshots.map(snapshot => goals.disarm(snapshot.id).catch(() => undefined)));
    });

    async function drive(sessionId: SessionId): Promise<void> {
      if (driving.has(sessionId) || stopped) return;
      driving.add(sessionId);
      try {
        const goal = await goals.get(sessionId);
        if (goal === undefined || goal.phase !== "active" || goal.activation !== "armed") return;
        if (goal.roundsStarted >= goal.maxGoalRounds) {
          await goals.block(sessionId, ref(goal), {
            code: "round-limit",
            message: `Goal reached its configured limit of ${goal.maxGoalRounds} rounds.`,
          });
          return;
        }
        const snapshot = await sessions.read(sessionId);
        if (snapshot === undefined) { await goals.disarm(sessionId); return; }
        const route = lastRoute(snapshot);
        if (route === undefined) {
          await goals.block(sessionId, ref(goal), { code: "route-missing", message: "Could not recover the Session model route for the next goal round." });
          return;
        }
        const admitted = await goals.startRound(sessionId, ref(goal));
        const execution = await agents.prompt({
          sessionId,
          cwd: route.cwd,
          model: route.model,
          prompt: renderGoalRoundPrompt(admitted, admitted.roundsStarted),
          promptSource: { kind: "goal" },
        });
        void execution.result.catch(async error => {
          const current = await goals.get(sessionId).catch(() => undefined);
          if (current?.phase === "active" && current.activation === "armed") {
            await goals.block(sessionId, ref(current), {
              code: "round-failed",
              message: `Goal round ${admitted.roundsStarted} failed: ${error instanceof Error ? error.message : String(error)}`,
            }).catch(() => undefined);
          }
        });
      } catch {
        await goals.disarm(sessionId).catch(() => undefined);
      } finally {
        driving.delete(sessionId);
      }
    }
  },
});

export function renderGoalRoundPrompt(goal: GoalView, round: number) {
  return [{ type: "text" as const, text: "<goal_round>\n"
    + `Objective: ${JSON.stringify(goal.objective)}\n`
    + `Round: ${round}/${goal.maxGoalRounds}\n\n`
    + "Continue working toward the objective in this same session. Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and mark it complete. If work remains, leave the goal active for the next round. Follow the configured goal-tool policy before reporting a blocker.\n"
    + "</goal_round>" }];
}

function ref(goal: GoalView): GoalRef { return { id: goal.id, revision: goal.revision }; }
function lastRoute(session: SessionSnapshot): { cwd: string; model: ModelRef } | undefined {
  const created = session.events.find(entry => entry.event.type === "session.created");
  if (created?.event.type !== "session.created") return undefined;
  const started = session.events.findLast(entry => entry.event.type === "run.started");
  if (started?.event.type !== "run.started") return undefined;
  return { cwd: created.event.payload.cwd, model: started.event.payload.model };
}

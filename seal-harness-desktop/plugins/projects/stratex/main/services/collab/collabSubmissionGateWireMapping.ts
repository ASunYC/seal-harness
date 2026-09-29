import {
  ProjectSubmissionGateSchema,
  type ProjectSubmissionGate,
  type ProjectSubmissionGateValues,
} from '../../../shared/protocol/project-submission-gate.js';
import { recordOf } from './collabWireMapping.js';

/** 门槛投影只读取约定中的配置面。 */
export function mapProjectSubmissionGate(raw: unknown): ProjectSubmissionGate | null {
  const record = recordOf(raw);
  const gate = recordOf(record?.submission_gate);
  const parsed = ProjectSubmissionGateSchema.safeParse({
    gateVersion: record?.gate_version,
    ruleVersion: record?.rule_version,
    submissionGate: {
      requireTasks: gate?.require_tasks,
      requireAllTasksDone: gate?.require_all_tasks_done,
      requireCriteria: gate?.require_criteria,
      requireReadyArtifacts: gate?.require_ready_artifacts,
    },
  });
  return parsed.success ? parsed.data : null;
}

/** 写入只含四个门槛，不携带 AI 文本。 */
export function submissionGateToWire(gate: ProjectSubmissionGateValues): Record<string, boolean> {
  return {
    require_tasks: gate.requireTasks,
    require_all_tasks_done: gate.requireAllTasksDone,
    require_criteria: gate.requireCriteria,
    require_ready_artifacts: gate.requireReadyArtifacts,
  };
}

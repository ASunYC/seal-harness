import { projectApi } from '../../../../src/ui/runtime';
import type {
  ProjectSubmissionGateRequest,
  ProjectSubmissionGateUpdateRequest,
  ProjectSubmissionGateResult,
} from '@shared/protocol/project-submission-gate.js';

/** 提交测试规则的桌面传输入口；身份由主进程推导。 */
export const projectSubmissionGateApi = {
  read(request: ProjectSubmissionGateRequest): Promise<ProjectSubmissionGateResult> {
    return projectApi().readProjectSubmissionGate(request);
  },
  update(request: ProjectSubmissionGateUpdateRequest): Promise<ProjectSubmissionGateResult> {
    return projectApi().updateProjectSubmissionGate(request);
  },
};

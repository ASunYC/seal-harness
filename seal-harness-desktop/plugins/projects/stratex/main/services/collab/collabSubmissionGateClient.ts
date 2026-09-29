import type {
  ProjectSubmissionGate,
  ProjectSubmissionGateRequest,
  ProjectSubmissionGateUpdateRequest,
} from '../../../shared/protocol/project-submission-gate.js';
import { failureFromBody, readBoundedJson, type CollabClientOutcome } from './collabClient.js';
import { recordOf } from './collabWireMapping.js';
import {
  mapProjectSubmissionGate,
  submissionGateToWire,
} from './collabSubmissionGateWireMapping.js';

/** 门槛复用约定端点与既有错误分档；不修改 AI 文本。 */
export class CollabSubmissionGateClient {
  constructor(
    private readonly options: {
      readonly baseUrl: string;
      readonly fetchImpl?: typeof fetch;
      readonly timeoutMs?: number;
    },
  ) {}

  readSubmissionGate(
    accessToken: string,
    input: ProjectSubmissionGateRequest,
  ): Promise<CollabClientOutcome<ProjectSubmissionGate>> {
    return this.request(accessToken, input.projectId);
  }

  updateSubmissionGate(
    accessToken: string,
    input: ProjectSubmissionGateUpdateRequest,
  ): Promise<CollabClientOutcome<ProjectSubmissionGate>> {
    return this.request(accessToken, input.projectId, {
      expected_version: input.expectedVersion,
      submission_gate: submissionGateToWire(input.submissionGate),
    });
  }

  private async request(
    accessToken: string,
    projectId: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<CollabClientOutcome<ProjectSubmissionGate>> {
    const base = this.options.baseUrl.endsWith('/')
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    const url = new URL(`api/v1/projects/${encodeURIComponent(projectId)}/conventions`, base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: body === undefined ? 'GET' : 'PATCH',
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const json = await readBoundedJson(response);
      if (response.status !== 200) return failureFromBody(response.status, json);
      const value = mapProjectSubmissionGate(recordOf(json)?.conventions);
      return value === null ? { ok: false, code: 'transient' } : { ok: true, value };
    } catch {
      // 超时、网络与响应流异常均保留可重试失败，不回显外部内容。
      return { ok: false, code: 'transient' };
    } finally {
      clearTimeout(timer);
    }
  }
}

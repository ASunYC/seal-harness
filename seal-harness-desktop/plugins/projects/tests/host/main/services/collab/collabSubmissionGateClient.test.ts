import { describe, expect, it, vi } from 'vitest';
import {
  mapProjectSubmissionGate,
  submissionGateToWire,
} from '../../../../../stratex/main/services/collab/collabSubmissionGateWireMapping.js';
import { CollabSubmissionGateClient } from '../../../../../stratex/main/services/collab/collabSubmissionGateClient.js';
import { createCollabClient } from '../../../../../stratex/main/services/collab/collabClient.js';

const serviceBaseUrl = 'https://example.test/';
const nestedServiceBaseUrl = new URL('prefix/', serviceBaseUrl).href;

const values = {
  requireTasks: true,
  requireAllTasksDone: false,
  requireCriteria: true,
  requireReadyArtifacts: false,
};
const wire = {
  require_tasks: true,
  require_all_tasks_done: false,
  require_criteria: true,
  require_ready_artifacts: false,
};

describe('提交门槛线协议', () => {
  it('读取四布尔与两条独立版本轴，忽略无关 AI 文本', () => {
    expect(
      mapProjectSubmissionGate({
        submission_gate: wire,
        gate_version: 2,
        rule_version: 7,
        ai_entry_rules: '保留',
      }),
    ).toEqual({ submissionGate: values, gateVersion: 2, ruleVersion: 7 });
  });
  it('写入只挑四个布尔', () => {
    expect(submissionGateToWire(values)).toEqual(wire);
  });
  it('缺项、伪布尔或非法版本均不可信', () => {
    for (const submission_gate of [{}, { ...wire, require_tasks: 1 }]) {
      expect(
        mapProjectSubmissionGate({ submission_gate, gate_version: 1, rule_version: 0 }),
      ).toBeNull();
    }
    expect(
      mapProjectSubmissionGate({ submission_gate: wire, gate_version: 0, rule_version: 1 }),
    ).toBeNull();
  });
});

describe('门槛 HTTP 客户端', () => {
  it('production client factory forwards gate reads and updates through the configured transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            conventions: { submission_gate: wire, gate_version: 3, rule_version: 8 },
          }),
        ),
    );
    const client = createCollabClient({
      baseUrl: nestedServiceBaseUrl,
      fetchImpl,
      timeoutMs: 1000,
    });
    expect(typeof client.readSubmissionGate).toBe('function');
    expect(await client.readSubmissionGate('test-token', { projectId: 'p' })).toMatchObject({
      ok: true,
      value: { gateVersion: 3, ruleVersion: 8 },
    });
    expect(
      await client.updateSubmissionGate('test-token', {
        projectId: 'p',
        submissionGate: values,
        expectedVersion: 7,
      }),
    ).toMatchObject({ ok: true });
    expect(fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ['https://example.test/prefix/api/v1/projects/p/conventions', 'GET'],
      ['https://example.test/prefix/api/v1/projects/p/conventions', 'PATCH'],
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      expected_version: 7,
      submission_gate: wire,
    });
  });

  it('PATCH 仅发送四门槛和行版本，令牌仅在请求头', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          conventions: { submission_gate: wire, gate_version: 3, rule_version: 8 },
        }),
      ),
    );
    const client = new CollabSubmissionGateClient({ baseUrl: serviceBaseUrl, fetchImpl });
    expect(
      await client.updateSubmissionGate('test-token', {
        projectId: 'p',
        submissionGate: values,
        expectedVersion: 7,
      }),
    ).toEqual({ ok: true, value: { submissionGate: values, gateVersion: 3, ruleVersion: 8 } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://example.test/api/v1/projects/p/conventions');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ expected_version: 7, submission_gate: wire });
    expect(init?.headers).toMatchObject({ authorization: 'Bearer test-token' });
  });
  it('409 和权限失败沿用既有分档，不重试', async () => {
    for (const [status, code] of [
      [409, 'conflict'],
      [403, 'forbidden'],
    ] as const) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: 'version_conflict', current_version: 9 }), {
          status,
        }),
      );
      const client = new CollabSubmissionGateClient({
        baseUrl: serviceBaseUrl,
        fetchImpl,
      });
      expect(await client.readSubmissionGate('test-token', { projectId: 'p' })).toMatchObject({
        ok: false,
        code,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it('不完整响应与网络拒绝都不是成功', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockRejectedValueOnce(new Error('offline'));
    const client = new CollabSubmissionGateClient({ baseUrl: serviceBaseUrl, fetchImpl });
    expect(await client.readSubmissionGate('test-token', { projectId: 'p' })).toEqual({
      ok: false,
      code: 'transient',
    });
    expect(await client.readSubmissionGate('test-token', { projectId: 'p' })).toEqual({
      ok: false,
      code: 'transient',
    });
  });
});

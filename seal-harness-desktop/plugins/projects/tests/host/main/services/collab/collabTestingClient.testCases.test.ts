import { describe, expect, it, vi } from 'vitest';

import { createCollabTestingClient } from '../../../../../stratex/main/services/collab/collabTestingClient.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const REQUIREMENT_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ROUND_ID = '55555555-5555-4555-8555-555555555555';

// 测试假地址独立成行：guard-no-runtime-fetch 按「同一行 fetch 词 + http://」判定。
const BASE_URL = 'http://collab.invalid/';

function caseWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CASE_ID,
    project_id: PROJECT_ID,
    requirement_id: REQUIREMENT_ID,
    submission_id: ROUND_ID,
    ordinal: 1,
    title: '邀请码过期后兑换被拒',
    preconditions: '',
    steps: '打开邀请链接\n点击兑换',
    expected: '提示邀请码已过期',
    result: 'notrun',
    copied_from_case_id: null,
    created_by_subject: 'u-henry',
    updated_by_subject: 'u-henry',
    version: 1,
    created_at: '2026-09-15T01:00:00+00:00',
    updated_at: '2026-09-15T01:00:00+00:00',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: ReturnType<typeof vi.fn>) {
  return createCollabTestingClient({
    baseUrl: BASE_URL,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function callOf(fetchImpl: ReturnType<typeof vi.fn>, index = 0) {
  const call = fetchImpl.mock.calls[index];
  const url = call?.[0] as URL;
  const init = call?.[1] as RequestInit | undefined;
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  return { url, init, body };
}

const DRAFT = {
  title: '邀请码过期后兑换被拒',
  preconditions: '',
  steps: '打开邀请链接\n点击兑换',
  expected: '提示邀请码已过期',
};

describe('CollabTestingClient 轮次用例列表', () => {
  it('按轮次打端点、游标与条数照发；映射出用例、总数与可复用来源', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        test_cases: [caseWire()],
        has_more: true,
        next_cursor: '1',
        total: 3,
        copy_source: { submission_id: OTHER_ROUND_ID, round_no: 1, case_count: 2 },
      }),
    );

    const outcome = await clientWith(fetchImpl).listRoundTestCases('tok', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      cursor: 'abc',
      limit: 20,
    });

    const { url, init } = callOf(fetchImpl);
    expect(init?.method).toBe('GET');
    expect(url.pathname).toBe(`/api/v1/submissions/${ROUND_ID}/test-cases`);
    expect(url.searchParams.get('cursor')).toBe('abc');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(outcome).toEqual({
      ok: true,
      value: {
        testCases: [
          expect.objectContaining({
            id: CASE_ID,
            submissionId: ROUND_ID,
            result: 'notrun',
            copiedFromCaseId: null,
          }),
        ],
        hasMore: true,
        nextCursor: '1',
        total: 3,
        copySource: { submissionId: OTHER_ROUND_ID, roundNo: 1, caseCount: 2 },
      },
    });
  });

  it('混进别的轮次或项目的用例 ⇒ 整页不可信（transient）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        test_cases: [caseWire({ submission_id: OTHER_ROUND_ID })],
        has_more: false,
        next_cursor: null,
        total: 1,
        copy_source: null,
      }),
    );

    const outcome = await clientWith(fetchImpl).listRoundTestCases('tok', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
    });

    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('4xx 带出业务码（400 invalid_cursor 不塌缩）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: 'invalid_cursor', detail: 'x' }),
    );

    const outcome = await clientWith(fetchImpl).listRoundTestCases('tok', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      cursor: 'bad',
    });

    expect(outcome).toEqual({ ok: false, code: 'rejected', serverCode: 'invalid_cursor' });
  });
});

describe('CollabTestingClient 新建与编辑用例', () => {
  it('⭐ 新建：请求体逐键就是服务端那五个键；201 新建、200 回放', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { test_case: caseWire() }))
      .mockResolvedValueOnce(jsonResponse(200, { test_case: caseWire() }));
    const client = clientWith(fetchImpl);
    const input = {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      clientRequestId: 'case-1',
      ...DRAFT,
    };

    const created = await client.createRoundTestCase('tok', input);
    const replayed = await client.createRoundTestCase('tok', input);

    const { url, init, body } = callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(`/api/v1/submissions/${ROUND_ID}/test-cases`);
    expect(body).toEqual({ client_request_id: 'case-1', ...DRAFT });
    expect(created).toEqual({
      ok: true,
      value: { testCase: expect.objectContaining({ id: CASE_ID }), replayed: false },
    });
    expect(replayed).toEqual({
      ok: true,
      value: { testCase: expect.objectContaining({ id: CASE_ID }), replayed: true },
    });
  });

  it('新建 400 带出 field 与 missing_fields；形状不对的附加键丢掉不编', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(400, {
          error: 'test_case_fields_required',
          missing_fields: ['title', 'steps'],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(400, { error: 'test_case_field_too_long', field: 'bogus' }),
      );
    const client = clientWith(fetchImpl);
    const input = { projectId: PROJECT_ID, submissionId: ROUND_ID, clientRequestId: 'c', ...DRAFT };

    expect(await client.createRoundTestCase('tok', input)).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'test_case_fields_required',
      missingFields: ['title', 'steps'],
    });
    expect(await client.createRoundTestCase('tok', input)).toEqual({
      ok: false,
      code: 'rejected',
      serverCode: 'test_case_field_too_long',
    });
  });

  it('回来的用例不属于请求的那一轮 ⇒ transient（不误报成功）', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(201, { test_case: caseWire({ submission_id: OTHER_ROUND_ID }) }),
    );

    const outcome = await clientWith(fetchImpl).createRoundTestCase('tok', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
      clientRequestId: 'c',
      ...DRAFT,
    });

    expect(outcome).toEqual({ ok: false, code: 'transient' });
  });

  it('⭐ 编辑：PATCH 四项 + expected_version；409 版本冲突带回 currentVersion 与业务码', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(409, { error: 'version_conflict', detail: 'x', current_version: 4 }),
    );

    const outcome = await clientWith(fetchImpl).updateTestCase('tok', {
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      expectedVersion: 2,
      ...DRAFT,
    });

    const { url, init, body } = callOf(fetchImpl);
    expect(init?.method).toBe('PATCH');
    expect(url.pathname).toBe(`/api/v1/test-cases/${CASE_ID}`);
    expect(body).toEqual({ expected_version: 2, ...DRAFT });
    expect(outcome).toEqual({
      ok: false,
      code: 'conflict',
      serverCode: 'version_conflict',
      currentVersion: 4,
    });
  });

  it('409 test_round_closed 没有版本号也照带业务码（不塌缩成无码 conflict）', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(409, { error: 'test_round_closed' }));

    const outcome = await clientWith(fetchImpl).updateTestCase('tok', {
      projectId: PROJECT_ID,
      caseId: CASE_ID,
      expectedVersion: 2,
      ...DRAFT,
    });

    expect(outcome).toEqual({ ok: false, code: 'conflict', serverCode: 'test_round_closed' });
  });
});

describe('CollabTestingClient 复用上轮与各轮条数', () => {
  it('复用：POST 不带体；映射复制条数与来源轮次', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        copied_count: 2,
        source_submission_id: OTHER_ROUND_ID,
        source_round_no: 1,
      }),
    );

    const outcome = await clientWith(fetchImpl).copyPreviousRoundTestCases('tok', {
      projectId: PROJECT_ID,
      submissionId: ROUND_ID,
    });

    const { url, init } = callOf(fetchImpl);
    expect(init?.method).toBe('POST');
    expect(url.pathname).toBe(`/api/v1/submissions/${ROUND_ID}/test-cases/copy-previous`);
    expect(init?.body).toBeUndefined();
    expect(outcome).toEqual({
      ok: true,
      value: { copiedCount: 2, sourceSubmissionId: OTHER_ROUND_ID, sourceRoundNo: 1 },
    });
  });

  it('各轮条数：按需求打端点；一条坏全批坏', async () => {
    const good = vi.fn(async () =>
      jsonResponse(200, { counts: [{ submission_id: ROUND_ID, case_count: 3 }] }),
    );
    const bad = vi.fn(async () =>
      jsonResponse(200, { counts: [{ submission_id: ROUND_ID, case_count: 0 }] }),
    );

    const outcome = await clientWith(good).listRequirementTestCaseCounts('tok', {
      projectId: PROJECT_ID,
      requirementId: REQUIREMENT_ID,
    });
    const broken = await clientWith(bad).listRequirementTestCaseCounts('tok', {
      projectId: PROJECT_ID,
      requirementId: REQUIREMENT_ID,
    });

    expect(callOf(good).url.pathname).toBe(`/api/v1/todos/${REQUIREMENT_ID}/test-case-counts`);
    expect(outcome).toEqual({
      ok: true,
      value: { counts: [{ submissionId: ROUND_ID, caseCount: 3 }] },
    });
    expect(broken).toEqual({ ok: false, code: 'transient' });
  });
});

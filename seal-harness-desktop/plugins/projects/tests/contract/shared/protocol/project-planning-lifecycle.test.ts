import { describe, expect, it } from 'vitest';

import { PROJECT_MAX_REFS, PROJECT_REF_TOKEN_PATTERN } from '../../../../stratex/shared/protocol/project-collab.js';

import {
  PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH,
  PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH,
  ProjectEvidenceLinkOpenRequestSchema,
  ProjectIterationLifecycleEventListResultSchema,
  ProjectIterationLifecycleEventSchema,
  ProjectIterationLifecycleRequestSchema,
  ProjectIterationLifecycleResultSchema,
  ProjectMilestoneLifecycleEventListRequestSchema,
  ProjectMilestoneLifecycleRequestSchema,
  isSafePlanningEvidenceLinkUrl,
  openablePlanningEvidenceLink,
  type PlanningEvidenceLinkParse,
  planningEvidenceLinkUrl,
  planningLifecycleActionFor,
  planningLifecycleRequiredStatus,
  projectPlanningLifecycleServerCodeText,
} from '../../../../stratex/shared/protocol/project-planning-lifecycle.js';

/**
 * 规划域生命周期契约（MIL-07）：完成 / 重开请求、阶段记录、业务码文案。
 *
 * ⭐ 盯的判据：
 *  - 契约 strict：账号字段、状态字段一概不可表达；**写入前**的证据引用与待办 refs 同形态（同一
 *    token 正则、同一条数上界），正文塞不进去；**读回**的证据引用只按服务端写入契约收（非空、
 *    ≤256、≤16），⛔ 不许比服务端严（一条就会让整页阶段记录取不回来）；
 *  - 「完成要证据、重开要原因」**不在形状层分叉**（必填由服务端判），所以空说明、空证据都可表达；
 *  - 失败业务码映射成人话，⛔ 码本身不出现在文案里；认不出的码回 null（调用方退回通用句）。
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const MILESTONE_ID = '22222222-2222-4222-8222-222222222222';
const ITERATION_ID = '33333333-3333-4333-8333-333333333333';
const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444';

const ITERATION_REQUEST = {
  projectId: PROJECT_ID,
  iterationId: ITERATION_ID,
  expectedVersion: 1,
  clientRequestId: 'req-1',
  reason: '三条验收用例全部通过',
  evidenceRefs: [`todo:${REQUIREMENT_ID}`],
} as const;

describe('lifecycle requests', () => {
  it('accepts the four contract fields for both objects', () => {
    expect(ProjectIterationLifecycleRequestSchema.parse(ITERATION_REQUEST)).toEqual(
      ITERATION_REQUEST,
    );
    const milestone = {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 3,
      clientRequestId: 'req-2',
      reason: '客户追加一轮验收',
      evidenceRefs: [],
    };
    expect(ProjectMilestoneLifecycleRequestSchema.parse(milestone)).toEqual(milestone);
  });

  it('keeps the required-field rule on the server（空说明 / 空证据在形状上可表达）', () => {
    // 必填差异是服务端业务规则（422）：形状层若先拒，服务端那句人话就永远到不了用户。
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        reason: '',
        evidenceRefs: [],
      }).success,
    ).toBe(true);
  });

  it('cannot express an account, a status or a free-text evidence', () => {
    for (const extra of [
      { accountKey: 'acc-1' },
      { status: 'completed' },
      { action: 'complete' },
    ]) {
      expect(
        ProjectIterationLifecycleRequestSchema.safeParse({ ...ITERATION_REQUEST, ...extra })
          .success,
      ).toBe(false);
    }
    // 证据是短 token（与待办 refs 同一正则）：空白与中文塞不进来。
    for (const evidence of ['验收通过的截图', 'todo: spaced', '']) {
      expect(
        ProjectIterationLifecycleRequestSchema.safeParse({
          ...ITERATION_REQUEST,
          evidenceRefs: [evidence],
        }).success,
      ).toBe(false);
    }
  });

  it('bounds evidence count and reason length at the shared limits', () => {
    const refs = (count: number) =>
      Array.from({ length: count }, (_, index) => `asset:file-${index}`);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        evidenceRefs: refs(PROJECT_MAX_REFS),
      }).success,
    ).toBe(true);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        evidenceRefs: refs(PROJECT_MAX_REFS + 1),
      }).success,
    ).toBe(false);
    expect(PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH).toBe(4_000);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        reason: 'a'.repeat(PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        reason: 'a'.repeat(PROJECT_PLANNING_LIFECYCLE_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('requires the idempotency key and a positive expected version', () => {
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        clientRequestId: '',
      }).success,
    ).toBe(false);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({ ...ITERATION_REQUEST, expectedVersion: 0 })
        .success,
    ).toBe(false);
  });

  it('carries currentVersion on every failure branch of a write result', () => {
    const failure = {
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'milestone_has_open_rounds',
    };
    expect(ProjectIterationLifecycleResultSchema.safeParse(failure).success).toBe(false);
    expect(
      ProjectIterationLifecycleResultSchema.safeParse({ ...failure, currentVersion: null }).success,
    ).toBe(true);
  });
});

describe('lifecycle stage records', () => {
  const record = {
    id: '55555555-5555-4555-8555-555555555555',
    iterationId: ITERATION_ID,
    fromStatus: 'open',
    toStatus: 'completed',
    actorSubject: 'u-alice',
    reason: '三条验收用例全部通过',
    evidenceRefs: [`todo:${REQUIREMENT_ID}`],
    occurredAt: '2026-09-05T08:00:00Z',
  };

  it('parses a record and a page of records', () => {
    expect(ProjectIterationLifecycleEventSchema.parse(record)).toEqual(record);
    expect(
      ProjectIterationLifecycleEventListResultSchema.parse({
        ok: true,
        items: [record],
        total: 1,
        page: 1,
        pageSize: 100,
      }),
    ).toMatchObject({ ok: true, total: 1 });
  });

  it('⭐ reads evidence refs by the server write contract, not the pre-submit token pattern', () => {
    // 服务端写入只要求「非空、≤256 字符、≤16 条」：含空白 / 中文的引用是合法数据，读侧照收。
    const loose = [
      '验收记录 第二版',
      'submission: 带空白',
      '引'.repeat(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH),
    ];
    expect(
      ProjectIterationLifecycleEventSchema.safeParse({ ...record, evidenceRefs: loose }).success,
    ).toBe(true);
    // 同一批引用在**写入前**被拦（本客户端只产出 token 形状）——严的是写侧，不是读侧。
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse({
        ...ITERATION_REQUEST,
        evidenceRefs: [loose[0]],
      }).success,
    ).toBe(false);
    // 越出服务端写入契约的才拒：空串、超长、超条数。
    for (const evidenceRefs of [
      [''],
      ['a'.repeat(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH + 1)],
      Array.from({ length: PROJECT_MAX_REFS + 1 }, (_, index) => `ref ${index}`),
    ]) {
      expect(
        ProjectIterationLifecycleEventSchema.safeParse({ ...record, evidenceRefs }).success,
      ).toBe(false);
    }
  });

  it('rejects statuses outside the lifecycle closed set and unknown keys', () => {
    expect(
      ProjectIterationLifecycleEventSchema.safeParse({ ...record, toStatus: 'done' }).success,
    ).toBe(false);
    expect(
      ProjectIterationLifecycleEventSchema.safeParse({ ...record, projectId: PROJECT_ID }).success,
    ).toBe(false);
  });

  it('bounds the stage-record page size like the rest of the planning lists', () => {
    const base = { projectId: PROJECT_ID, milestoneId: MILESTONE_ID };
    expect(
      ProjectMilestoneLifecycleEventListRequestSchema.safeParse({ ...base, pageSize: 100 }).success,
    ).toBe(true);
    expect(
      ProjectMilestoneLifecycleEventListRequestSchema.safeParse({ ...base, pageSize: 101 }).success,
    ).toBe(false);
  });
});

describe('lifecycle presentation helpers', () => {
  it('offers the action the current status allows, and names the status each action needs', () => {
    expect(planningLifecycleActionFor('open')).toBe('complete');
    expect(planningLifecycleActionFor('completed')).toBe('reopen');
    expect(planningLifecycleRequiredStatus('complete')).toBe('open');
    expect(planningLifecycleRequiredStatus('reopen')).toBe('completed');
  });

  const CODES = [
    'completion_note_required',
    'completion_evidence_required',
    'reopen_reason_required',
    'evidence_link_invalid',
    'milestone_needs_a_round',
    'milestone_has_open_rounds',
    'milestone_already_completed',
    'iteration_already_completed',
    'milestone_not_completed',
    'iteration_not_completed',
    'idempotency_conflict',
    'idempotency_retry',
    'milestone_not_found',
    'iteration_not_found',
    'project_archived',
    'milestone_archived',
    'iteration_archived',
  ] as const;

  it.each(CODES)('maps %s to plain Chinese without leaking the code', (code) => {
    const text = projectPlanningLifecycleServerCodeText(code);
    expect(text).toMatch(/[一-鿿]/u);
    expect(text).not.toContain(code);
    // 业务码的蛇形片段也不许漏进文案（`_` 在中文句子里没有合法出现的理由）。
    expect(text).not.toContain('_');
  });

  it('no longer maps the retired archive-refusal codes (ADR-0040: archiving moves scheduled requirements out)', () => {
    // 归档不再因在排需求被拒：两个旧码已不存在，⛔ 别留一句「请先移出再归档」误导人。
    expect(
      projectPlanningLifecycleServerCodeText('iteration_has_active_requirement_schedule'),
    ).toBeNull();
    expect(
      projectPlanningLifecycleServerCodeText('milestone_has_active_requirement_schedule'),
    ).toBeNull();
  });

  it('returns null for unknown or absent codes so callers fall back to the generic copy', () => {
    expect(projectPlanningLifecycleServerCodeText('version_conflict')).toBeNull();
    expect(projectPlanningLifecycleServerCodeText('something_new')).toBeNull();
    expect(projectPlanningLifecycleServerCodeText(undefined)).toBeNull();
    expect(projectPlanningLifecycleServerCodeText(null)).toBeNull();
  });
});

describe('evidence links (ADR-0036)', () => {
  const withRefs = (evidenceRefs: string[]) => ({ ...ITERATION_REQUEST, evidenceRefs });
  const LINK_HEAD = 'link:https://example.com/';

  it('⭐ accepts a full http / https link next to todo and asset tokens before submit', () => {
    const refs = [
      `todo:${REQUIREMENT_ID}`,
      'link:https://example.com/report?id=7&page=2#acceptance',
      'link:HTTP://EXAMPLE.ORG/acceptance',
    ];
    expect(ProjectIterationLifecycleRequestSchema.parse(withRefs(refs)).evidenceRefs).toEqual(refs);
    // 整条 token 恰好 256 字符仍收（上界按整条算，含前缀）。
    const exact =
      LINK_HEAD + 'a'.repeat(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH - LINK_HEAD.length);
    expect(exact).toHaveLength(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH);
    expect(ProjectIterationLifecycleRequestSchema.safeParse(withRefs([exact])).success).toBe(true);
  });

  it('⭐ rejects script, local file, schemeless, userinfo, blank and overlong links before submit', () => {
    const control = String.fromCharCode(1);
    const rightToLeftOverride = String.fromCharCode(0x202e);
    const backslash = String.fromCharCode(0x5c);
    const rejected = [
      // 共用 token 闭集的字符集放得过这一串 ⇒ `link:` 只要落回共用规则兜底，这一条就会被放行。
      'link:javascript:void',
      'link:javascript:alert(1)',
      // 带 `://` 的脚本地址走到协议闸才被拦：⛔ 变异锚点「协议闭集放进 javascript」让这一条转红。
      'link:javascript://example.com/%0Aalert(1)',
      'link:file:///C:/temp/report.docx',
      'link:example.com/report',
      'link:ftp://example.com/report',
      'link:https://user:secret@example.com/',
      'link:https://user@example.com/',
      'link:https://@example.com/',
      'link:https://example.com@evil.example/',
      `link:https://evil.example${backslash}example.com/`,
      'link:https:///report',
      'link:https://:8443/report',
      'link:https://[/report',
      // 主机段结构不合规：端口越界 / 非数字、IPv6 没加方括号、方括号后缀、主机里的非法字符。
      'link:https://example.com:99999/report',
      'link:https://example.com:1:2/',
      'link:https://2001:db8::1/path',
      'link:https://[::1]xyz/',
      'link:https://[a]/',
      'link:https://exa<mple.com/',
      'link:https://ex%61mple.com/',
      'link:https://exa mple.com/',
      `link:https://example.com/${control}`,
      `link:https://example.com/${rightToLeftOverride}fdp.exe`,
      LINK_HEAD + 'a'.repeat(PROJECT_PLANNING_EVIDENCE_REF_MAX_LENGTH - LINK_HEAD.length + 1),
    ];
    for (const token of rejected) {
      expect(
        ProjectIterationLifecycleRequestSchema.safeParse(withRefs([token])).success,
        token,
      ).toBe(false);
    }
    // 正向对照：同样的前缀、合规的地址就收——拒的是地址，不是 `link:` 本身。
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse(withRefs([`${LINK_HEAD}report`])).success,
    ).toBe(true);
  });

  it('keeps the shared todo / feed token closed set untouched (links get their own rule)', () => {
    // 共用闭集没有为链接放宽：带查询串的地址不是合法的普通 token，只能走 `link:` 规则。
    expect(PROJECT_REF_TOKEN_PATTERN.test('https://example.com/report?id=7')).toBe(false);
    expect(
      ProjectIterationLifecycleRequestSchema.safeParse(
        withRefs(['https://example.com/report?id=7']),
      ).success,
    ).toBe(false);
  });

  it('reads back malformed link-like refs without failing the page, and never treats them as openable', () => {
    const record = {
      id: '55555555-5555-4555-8555-555555555555',
      iterationId: ITERATION_ID,
      fromStatus: 'open',
      toStatus: 'completed',
      actorSubject: 'u-alice',
      reason: '三条验收用例全部通过',
      evidenceRefs: [
        'link:https://example.com/report',
        'link:javascript:void',
        'link:not a url',
        'link:https://user:pw@example.com/',
      ],
      occurredAt: '2026-09-05T08:00:00Z',
    };
    expect(ProjectIterationLifecycleEventSchema.safeParse(record).success).toBe(true);
    expect(record.evidenceRefs.map(planningEvidenceLinkUrl)).toEqual([
      'https://example.com/report',
      null,
      null,
      null,
    ]);
    expect(planningEvidenceLinkUrl(`todo:${REQUIREMENT_ID}`)).toBeNull();
  });

  it('judges by grammar: ports, bracketed hosts, upper-case schemes and an `@` outside the host are fine', () => {
    for (const url of [
      'https://example.com',
      'https://example.com:8443/path',
      'https://example.com:/empty-port',
      'http://192.0.2.10:65535/max-port',
      'https://[2001:db8::1]:8080/status',
      'HTTPS://EXAMPLE.COM/Upper',
      'https://example.com/people/@team?next=javascript://x',
    ]) {
      expect(isSafePlanningEvidenceLinkUrl(url), url).toBe(true);
    }
    // 协议闸只认 `://` 之前的整段：`http:x` 不是 http。
    expect(isSafePlanningEvidenceLinkUrl('http:x://example.com/')).toBe(false);
    expect(isSafePlanningEvidenceLinkUrl('https://[]/')).toBe(false);
    expect(isSafePlanningEvidenceLinkUrl('https://example.com:65536/')).toBe(false);
  });

  it('⭐ openable only when the grammar passes and the injected parser agrees (http/https, no account, a host)', () => {
    const parsed = (
      overrides: Partial<PlanningEvidenceLinkParse> = {},
    ): PlanningEvidenceLinkParse => ({
      protocol: 'https:',
      username: '',
      password: '',
      hostname: 'example.com',
      href: 'https://example.com/report',
      ...overrides,
    });
    let calls = 0;
    const parser = (result: PlanningEvidenceLinkParse) => (): PlanningEvidenceLinkParse => {
      calls += 1;
      return result;
    };

    expect(openablePlanningEvidenceLink('https://example.com/report', parser(parsed()))).toEqual(
      parsed(),
    );
    // 文法不过：解析器一次都不调。
    calls = 0;
    expect(openablePlanningEvidenceLink('javascript:alert(1)', parser(parsed()))).toBeNull();
    expect(calls).toBe(0);
    // 文法过得了、解析器解不了（真实解析器对 `[:::]` 抛错）：不可打开。
    expect(
      openablePlanningEvidenceLink('https://[:::]/', () => {
        throw new TypeError('Invalid URL');
      }),
    ).toBeNull();
    // 解析器给出的协议、账号、密码、主机任何一项不对，都不可打开。
    for (const override of [
      { protocol: 'javascript:' },
      { username: 'user' },
      { password: 'secret' },
      { hostname: '' },
    ]) {
      expect(
        openablePlanningEvidenceLink('https://example.com/report', parser(parsed(override))),
        JSON.stringify(override),
      ).toBeNull();
    }
  });

  it('describes the open-link request by shape only — the main process re-checks the address', () => {
    // 形状层故意不判协议：主进程处理器里的二次校验才是门（见 projectCollabHandlersPlanning）。
    expect(
      ProjectEvidenceLinkOpenRequestSchema.safeParse({ url: 'javascript:alert(1)' }).success,
    ).toBe(true);
    expect(isSafePlanningEvidenceLinkUrl('javascript:alert(1)')).toBe(false);
    expect(ProjectEvidenceLinkOpenRequestSchema.safeParse({ url: '' }).success).toBe(false);
    expect(
      ProjectEvidenceLinkOpenRequestSchema.safeParse({
        url: 'https://example.com/',
        accountKey: 'acc-1',
      }).success,
    ).toBe(false);
  });
});

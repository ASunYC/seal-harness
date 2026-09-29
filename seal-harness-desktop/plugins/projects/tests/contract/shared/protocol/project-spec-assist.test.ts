import { describe, expect, it } from 'vitest';

import {
  PROJECT_SPEC_ASSIST_MAX_DESCRIPTION_LENGTH,
  PROJECT_SPEC_ASSIST_REFERENCE_CODES,
  ProjectSpecAssistCancelRequestSchema,
  ProjectSpecAssistErrorCodeSchema,
  ProjectSpecAssistReadinessResultSchema,
  ProjectSpecAssistRequestSchema,
  ProjectSpecAssistResultSchema,
  TodoSpecSuggestionSchema,
} from '../../../../stratex/shared/protocol/project-spec-assist.js';

/**
 * 派单表单「让助理补全」的两端契约（ADR-0043）。
 *
 * 钉的是改了就会出事的形状：
 *  ① 请求里结构性没有账号与模型选择字段（strictObject 拒多余键）；
 *  ② 建议的描述上界按**服务端**写入上限 4000 取，不按表单的 20000；
 *  ③ 越界一律拒绝，不在契约层截断；
 *  ④ 失败码与参考编号一一对应、编号不重复。
 */

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    projectId: PROJECT_ID,
    itemKind: 'task',
    title: '核查这批矢量数据',
    ...overrides,
  };
}

describe('生成请求', () => {
  it('只带标题即可发起', () => {
    expect(ProjectSpecAssistRequestSchema.safeParse(request()).success).toBe(true);
  });

  it('可带父项标题与三段已填内容', () => {
    const parsed = ProjectSpecAssistRequestSchema.safeParse(
      request({
        parentTitle: '二期入库',
        description: '已有目标',
        acceptanceItems: ['条目一'],
        constraintsText: '不许动生产库',
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['空标题', { title: '' }],
    ['纯空白标题', { title: '   ' }],
    ['标题超长', { title: 'x'.repeat(241) }],
    ['标题含 NUL', { title: 'a\0b' }],
    ['描述超长', { description: 'x'.repeat(20_001) }],
    ['验收 21 条', { acceptanceItems: Array.from({ length: 21 }, (_, i) => `条目${i}`) }],
    ['验收单条 501 字', { acceptanceItems: ['x'.repeat(501)] }],
    ['验收空白条', { acceptanceItems: ['  '] }],
    ['注意事项超长', { constraintsText: 'x'.repeat(4_001) }],
    ['种类不在闭集', { itemKind: 'epic' }],
    ['请求号不是 uuid', { requestId: 'abc' }],
  ])('拒绝：%s', (_label, overrides) => {
    expect(ProjectSpecAssistRequestSchema.safeParse(request(overrides)).success).toBe(false);
  });

  it('拒绝夹带账号或模型选择（结构性不可表达）', () => {
    expect(ProjectSpecAssistRequestSchema.safeParse(request({ accountKey: 'a' })).success).toBe(
      false,
    );
    expect(
      ProjectSpecAssistRequestSchema.safeParse(request({ connectionId: 'c', remoteModelId: 'm' }))
        .success,
    ).toBe(false);
  });

  it('缺请求号即拒', () => {
    const { requestId: _requestId, ...rest } = request();
    void _requestId;
    expect(ProjectSpecAssistRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe('建议', () => {
  it('描述上界取服务端写入上限 4000，不取表单的 20000', () => {
    expect(PROJECT_SPEC_ASSIST_MAX_DESCRIPTION_LENGTH).toBe(4_000);
    const ok = { description: 'x'.repeat(4_000), acceptanceItems: [], constraintsText: '' };
    expect(TodoSpecSuggestionSchema.safeParse(ok).success).toBe(true);
    expect(
      TodoSpecSuggestionSchema.safeParse({ ...ok, description: 'x'.repeat(4_001) }).success,
    ).toBe(false);
  });

  it('验收条目按工作单同界：≤20 条、单条 ≤500、非空白', () => {
    const base = { description: '', constraintsText: '' };
    expect(
      TodoSpecSuggestionSchema.safeParse({
        ...base,
        acceptanceItems: Array.from({ length: 21 }, () => '条目'),
      }).success,
    ).toBe(false);
    expect(
      TodoSpecSuggestionSchema.safeParse({ ...base, acceptanceItems: ['x'.repeat(501)] }).success,
    ).toBe(false);
    expect(TodoSpecSuggestionSchema.safeParse({ ...base, acceptanceItems: [' '] }).success).toBe(
      false,
    );
  });

  it('三个键缺一不可，多余键拒绝', () => {
    expect(
      TodoSpecSuggestionSchema.safeParse({ description: '', acceptanceItems: [] }).success,
    ).toBe(false);
    expect(
      TodoSpecSuggestionSchema.safeParse({
        description: '',
        acceptanceItems: [],
        constraintsText: '',
        basis: 'input',
      }).success,
    ).toBe(false);
  });
});

describe('结果信封', () => {
  it('成功带请求号与建议', () => {
    expect(
      ProjectSpecAssistResultSchema.safeParse({
        ok: true,
        requestId: REQUEST_ID,
        suggestion: { description: '目标', acceptanceItems: ['一'], constraintsText: '' },
      }).success,
    ).toBe(true);
  });

  it('失败的请求号可空（入参校验前无从得知）', () => {
    expect(
      ProjectSpecAssistResultSchema.safeParse({
        ok: false,
        requestId: null,
        code: 'invalidRequest',
        message: '请求不合法。',
        referenceCode: PROJECT_SPEC_ASSIST_REFERENCE_CODES.invalidRequest,
      }).success,
    ).toBe(true);
  });

  it('就绪查询只回三档之一', () => {
    for (const state of ['ready', 'modelNotSupported', 'modelUnavailable']) {
      expect(ProjectSpecAssistReadinessResultSchema.safeParse({ ok: true, state }).success).toBe(
        true,
      );
    }
    expect(
      ProjectSpecAssistReadinessResultSchema.safeParse({ ok: true, state: 'maybe' }).success,
    ).toBe(false);
  });

  it('取消只认请求号', () => {
    expect(ProjectSpecAssistCancelRequestSchema.safeParse({ requestId: REQUEST_ID }).success).toBe(
      true,
    );
    expect(
      ProjectSpecAssistCancelRequestSchema.safeParse({ requestId: REQUEST_ID, force: true })
        .success,
    ).toBe(false);
  });
});

describe('失败码与参考编号', () => {
  it('每个失败码都有编号，且编号互不重复', () => {
    const codes = ProjectSpecAssistErrorCodeSchema.options;
    const numbers = codes.map((code) => PROJECT_SPEC_ASSIST_REFERENCE_CODES[code]);
    expect(numbers.every((value) => /^STRX-SPEC-\d{3}$/u.test(value))).toBe(true);
    expect(new Set(numbers).size).toBe(codes.length);
  });

  it('「默认模型条款不允许」与「没有可用模型」是两档，不塌缩', () => {
    expect(PROJECT_SPEC_ASSIST_REFERENCE_CODES.modelNotSupported).not.toBe(
      PROJECT_SPEC_ASSIST_REFERENCE_CODES.modelUnavailable,
    );
  });
});

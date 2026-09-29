import { describe, expect, it } from 'vitest';
import {
  ProjectTestModeSchema,
  SERVICE_CAPABILITY,
  ServiceCapabilitiesSchema,
  dictionaryWriteRequiresUpgrade,
  hasCapability,
  type ServiceCapabilities,
} from '../../../../stratex/shared/protocol/project-collab-capabilities.js';

const withCaps = (flags: readonly string[]): ServiceCapabilities => ({
  capabilities: [...flags],
  serviceVersion: '0.1.0',
});

/** 项目级测试模式判定里的一条活动轮次摘要（⛔ 不带整体完成说明）。 */
const activeRound = (index: number): Record<string, unknown> => ({
  id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
  projectId: '11111111-1111-4111-8111-111111111111',
  requirementId: '22222222-2222-4222-8222-222222222222',
  roundNo: 1,
  state: 'queued',
  submittedBySubject: 'u-me',
  reviewerSubject: 'u-other',
  version: 1,
  createdAt: '2026-09-14T08:00:00Z',
  updatedAt: '2026-09-14T08:00:00Z',
});

describe('SERVICE_CAPABILITY 契约', () => {
  it('字符串与服务端 domain_capabilities.SERVICE_CAPABILITIES 逐字对齐', () => {
    // ⚠️ 改这些串必须同步改服务端那份（本仓无自动同步器）。
    expect(Object.values(SERVICE_CAPABILITY)).toEqual([
      'chat_idempotency',
      'chat_search',
      'requirement.dictionaries',
      'requirement.time_facts',
      'requirement.status_events',
      'requirement.paging',
      'requirement.summary',
      'requirement.subtask_summary',
      'requirement.test_mode',
      'requirement.optional_test_reviewer',
      'requirement.test_cases',
    ]);
  });

  it('测试轮次的用例能力随 TST-04 进清单', () => {
    expect(SERVICE_CAPABILITY.requirementTestCases).toBe('requirement.test_cases');
  });

  it('整需求提测能力随 TST-02 进清单（D-TEST-01 已定案选 A）', () => {
    expect(SERVICE_CAPABILITY.requirementTestMode).toBe('requirement.test_mode');
    expect(SERVICE_CAPABILITY.optionalTestReviewer).toBe('requirement.optional_test_reviewer');
  });
});

describe('hasCapability', () => {
  it('命中/未命中/未协商三态', () => {
    const caps = withCaps([SERVICE_CAPABILITY.requirementDictionaries]);
    expect(hasCapability(caps, SERVICE_CAPABILITY.requirementDictionaries)).toBe(true);
    expect(hasCapability(caps, SERVICE_CAPABILITY.requirementPaging)).toBe(false);
    expect(hasCapability(null, SERVICE_CAPABILITY.requirementDictionaries)).toBe(false);
  });
});

describe('dictionaryWriteRequiresUpgrade（判据 1「旧服务禁发新增写字段」）', () => {
  it('确知对面无 dictionaries 且携带 moduleId ⇒ 需升级、不许发', () => {
    const legacy = withCaps([]);
    expect(dictionaryWriteRequiresUpgrade(legacy, { moduleId: 'm-1' })).toBe(true);
  });

  it('显式清空（moduleId=null）也算携带 ⇒ 同样需升级', () => {
    const legacy = withCaps([SERVICE_CAPABILITY.requirementPaging]);
    expect(dictionaryWriteRequiresUpgrade(legacy, { categoryId: null })).toBe(true);
  });

  it('对面支持 dictionaries ⇒ 照发', () => {
    const modern = withCaps([SERVICE_CAPABILITY.requirementDictionaries]);
    expect(dictionaryWriteRequiresUpgrade(modern, { moduleId: 'm-1' })).toBe(false);
  });

  it('请求未携带归类字段 ⇒ 不拦（即便对面是旧服务）', () => {
    const legacy = withCaps([]);
    expect(dictionaryWriteRequiresUpgrade(legacy, {})).toBe(false);
  });

  it('尚未协商到能力（null）⇒ 不拦（服务端仍是最终权威）', () => {
    expect(dictionaryWriteRequiresUpgrade(null, { moduleId: 'm-1' })).toBe(false);
  });
});

describe('schema 结构闸', () => {
  it('ServiceCapabilities 接受合法能力清单', () => {
    expect(
      ServiceCapabilitiesSchema.safeParse({
        capabilities: ['requirement.dictionaries'],
        serviceVersion: '0.1.0',
      }).success,
    ).toBe(true);
  });

  it('ProjectTestMode 接受空 testRounds', () => {
    expect(
      ProjectTestModeSchema.safeParse({
        mode: 'legacy',
        canEnableNewMode: false,
        blockedReasons: ['open_legacy_review'],
        legacyOpenReviewCount: 2,
        testRounds: [],
      }).success,
    ).toBe(true);
  });

  it('ProjectTestMode 放开新模式：rounds 模式带真实活动轮次摘要（至多 100 条）', () => {
    const rounds = Array.from({ length: 100 }, (_unused, index) => activeRound(index));
    expect(
      ProjectTestModeSchema.safeParse({
        mode: 'rounds',
        canEnableNewMode: true,
        blockedReasons: [],
        legacyOpenReviewCount: 0,
        testRounds: rounds,
      }).success,
    ).toBe(true);
    expect(
      ProjectTestModeSchema.safeParse({
        mode: 'rounds',
        canEnableNewMode: true,
        blockedReasons: [],
        legacyOpenReviewCount: 0,
        testRounds: [...rounds, activeRound(100)],
      }).success,
    ).toBe(false);
  });

  it('⛔ ProjectTestMode 拒绝不是轮次形状的 testRounds 与未知模式（不采信虚构的历史轮次）', () => {
    const base = {
      mode: 'legacy',
      canEnableNewMode: false,
      blockedReasons: ['open_legacy_review'],
      legacyOpenReviewCount: 1,
    };
    expect(ProjectTestModeSchema.safeParse({ ...base, testRounds: [{ round: 1 }] }).success).toBe(
      false,
    );
    expect(
      ProjectTestModeSchema.safeParse({
        ...base,
        testRounds: [{ ...activeRound(0), summary: '正文不进项目级判定' }],
      }).success,
    ).toBe(false);
    expect(
      ProjectTestModeSchema.safeParse({ ...base, mode: 'hybrid', testRounds: [] }).success,
    ).toBe(false);
  });
});

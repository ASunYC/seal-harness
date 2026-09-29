import { describe, expect, it } from 'vitest';

import {
  PROJECT_DATA_SOURCE_REFERENCE_CODES,
  ProjectDataSourceCreateRequestSchema,
  ProjectDataSourceErrorCodeSchema,
  ProjectDataSourceListResultSchema,
  ProjectDataSourceSchema,
  ProjectDataSourceSyncRequestSchema,
  ProjectDataSourceSyncSummarySchema,
  ProjectDataSourceTicketSaveRequestSchema,
  ProjectDataSourceUpdateRequestSchema,
  ProjectExternalLinkSchema,
} from '../../../../stratex/shared/protocol/project-datasource.js';

/**
 * 外部数据源契约的结构性判据。
 *
 * 这里钉的都是**改了就会出事**的形状，不是「schema 能 parse 一个样例」：
 *  ① 同步请求里不许出现票据字段（红线 2 的结构性载体）；
 *  ② `gitRef` 的「显式 null」与「缺席」必须分得开（服务端按 fields_set 判）；
 *  ③ 失败码与参考编号一一对应、编号不重复（一码一号，已发出的号不可复用）；
 *  ④ 闭集就是闭集（外部条目类别、同步状态、票据携带方式）。
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';

describe('同步请求：票据不可表达', () => {
  it('接受只带两个 id 的意图', () => {
    const parsed = ProjectDataSourceSyncRequestSchema.safeParse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(parsed.success).toBe(true);
  });

  it('拒绝夹带票据的同步请求（strictObject 拒多余键）', () => {
    const parsed = ProjectDataSourceSyncRequestSchema.safeParse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      accessToken: 'glpat-not-allowed',
    });
    expect(parsed.success).toBe(false);
  });

  it('保存票据是唯一一条能表达票据的路径', () => {
    const parsed = ProjectDataSourceTicketSaveRequestSchema.safeParse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      ticket: 'glpat-personal',
      scheme: 'privateToken',
    });
    expect(parsed.success).toBe(true);
    // 携带方式是闭集：不认的值一律拒（服务端 Literal 同口径）。
    expect(
      ProjectDataSourceTicketSaveRequestSchema.safeParse({
        projectId: PROJECT_ID,
        dataSourceId: SOURCE_ID,
        ticket: 'glpat-personal',
        scheme: 'basic',
      }).success,
    ).toBe(false);
  });
});

describe('更新请求：gitRef 的两档语义', () => {
  it('显式 null 与缺席都合法，且键在不在能分得开', () => {
    const explicitNull = ProjectDataSourceUpdateRequestSchema.parse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      gitRef: null,
    });
    const absent = ProjectDataSourceUpdateRequestSchema.parse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
      enabled: false,
    });
    expect('gitRef' in explicitNull).toBe(true);
    expect(explicitNull.gitRef).toBeNull();
    expect('gitRef' in absent).toBe(false);
  });

  it('一个可改字段都不给时拒绝（服务端会回 no_changes，早一步拦住）', () => {
    const parsed = ProjectDataSourceUpdateRequestSchema.safeParse({
      projectId: PROJECT_ID,
      dataSourceId: SOURCE_ID,
    });
    expect(parsed.success).toBe(false);
  });

  it('新建请求不接受 dataSourceId 一类的多余键', () => {
    expect(
      ProjectDataSourceCreateRequestSchema.safeParse({
        projectId: PROJECT_ID,
        baseUrl: 'http://code.internal',
        repoPath: 'group/repo',
        includeProcessDocs: true,
      }).success,
    ).toBe(false);
  });
});

describe('失败码与参考编号', () => {
  it('每个失败码都有编号，且编号互不重复', () => {
    const codes = ProjectDataSourceErrorCodeSchema.options;
    const numbers = codes.map((code) => PROJECT_DATA_SOURCE_REFERENCE_CODES[code]);
    expect(numbers.every((value) => /^STRX-DSRC-\d{3}$/u.test(value))).toBe(true);
    expect(new Set(numbers).size).toBe(codes.length);
  });

  it('把「本部署没开外部数据源」保留为独立一档，不与通用拒绝同码', () => {
    // 这一条是这条线存在的理由：白名单缺省为空 ⇒ 503 是设计而不是故障，
    // 它与 rejected/transient 必须是**不同的**码，否则界面无从给出正确的话。
    expect(ProjectDataSourceErrorCodeSchema.options).toContain('externalSourcesDisabled');
    expect(PROJECT_DATA_SOURCE_REFERENCE_CODES.externalSourcesDisabled).not.toBe(
      PROJECT_DATA_SOURCE_REFERENCE_CODES.rejected,
    );
    expect(PROJECT_DATA_SOURCE_REFERENCE_CODES.externalSourcesDisabled).not.toBe(
      PROJECT_DATA_SOURCE_REFERENCE_CODES.transient,
    );
  });
});

describe('投影闭集', () => {
  const source = {
    id: SOURCE_ID,
    kind: 'gitlab' as const,
    baseUrl: 'http://code.internal',
    repoPath: 'group/repo',
    gitRef: null,
    enabled: true,
    includeDocuments: true,
    includeProcessDocs: false,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncDetail: null,
    createdBySubject: 'u-1',
    createdAt: '2026-08-29T00:00:00Z',
    updatedAt: '2026-08-29T00:00:00Z',
  };

  it('数据源投影里没有任何凭据字段（服务端表里也没有）', () => {
    const parsed = ProjectDataSourceSchema.parse(source);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'baseUrl',
        'createdAt',
        'createdBySubject',
        'enabled',
        'gitRef',
        'id',
        'includeDocuments',
        'includeProcessDocs',
        'kind',
        'lastSyncDetail',
        'lastSyncStatus',
        'lastSyncedAt',
        'repoPath',
        'updatedAt',
      ].sort(),
    );
  });

  it('上次同步状态只有 ok / failed 两档', () => {
    expect(ProjectDataSourceSchema.safeParse({ ...source, lastSyncStatus: 'ok' }).success).toBe(
      true,
    );
    expect(
      ProjectDataSourceSchema.safeParse({ ...source, lastSyncStatus: 'running' }).success,
    ).toBe(false);
  });

  it('对账行只认四类外部条目与两档来源状态', () => {
    const link = {
      id: '33333333-3333-4333-8333-333333333333',
      dataSourceId: SOURCE_ID,
      externalKind: 'todoItem' as const,
      externalKey: 'todo:task-a#1',
      todoId: '44444444-4444-4444-8444-444444444444',
      fileId: null,
      linkState: 'orphaned' as const,
      orphanedAt: '2026-08-29T00:00:00Z',
      externalUpdatedAt: null,
      updatedAt: '2026-08-29T00:00:00Z',
    };
    expect(ProjectExternalLinkSchema.safeParse(link).success).toBe(true);
    expect(
      ProjectExternalLinkSchema.safeParse({ ...link, externalKind: 'todo_item' }).success,
    ).toBe(false);
    expect(ProjectExternalLinkSchema.safeParse({ ...link, linkState: 'deleted' }).success).toBe(
      false,
    );
  });

  it('同步回执带得动诊断条目与「还有多少条没列出来」', () => {
    const summary = ProjectDataSourceSyncSummarySchema.parse({
      todosCreated: 1,
      todosUpdated: 0,
      todosUnchanged: 2,
      documentsCreated: 0,
      documentsUpdated: 0,
      documentsUnchanged: 0,
      orphaned: 3,
      detail: '摘要',
      diagnostics: ['文档 a/prd.md：1234 字节超过单份上限 1000，已跳过'],
      diagnosticsTotal: 51,
    });
    expect(summary.diagnostics).toHaveLength(1);
    expect(summary.diagnosticsTotal).toBe(51);
  });

  it('列表结果只答「哪几个存过票据」，没有承载票据的字段', () => {
    const parsed = ProjectDataSourceListResultSchema.parse({
      ok: true,
      dataSources: [source],
      ticketedDataSourceIds: [SOURCE_ID],
    });
    expect(JSON.stringify(parsed)).not.toContain('ticket"');
    expect(
      ProjectDataSourceListResultSchema.safeParse({
        ok: true,
        dataSources: [source],
        ticketedDataSourceIds: [SOURCE_ID],
        tickets: { [SOURCE_ID]: 'glpat-leak' },
      }).success,
    ).toBe(false);
  });
});

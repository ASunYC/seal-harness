import { describe, expect, it } from 'vitest';

import {
  ProjectChatHistoryRequestSchema,
  ProjectChatHistoryResultSchema,
} from '../../../../stratex/shared/protocol/project-collab.js';
import { SERVICE_CAPABILITY } from '../../../../stratex/shared/protocol/project-collab-capabilities.js';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('正文搜索与普通历史契约', () => {
  it('搜索请求规范化正文并保留独立分页游标', () => {
    expect(
      ProjectChatHistoryRequestSchema.parse({
        projectId,
        search: { query: '  部署检查  ', cursor: 'page-token' },
        limit: 20,
      }),
    ).toEqual({ projectId, search: { query: '部署检查', cursor: 'page-token' }, limit: 20 });
    expect(SERVICE_CAPABILITY.chatSearch).toBe('chat_search');
  });

  it.each([
    { search: { query: ' ' } },
    { search: { query: '字'.repeat(129) } },
    { search: { query: '正文', cursor: '' } },
    { search: { query: '正文', cursor: 'x'.repeat(2049) } },
    { search: { query: '正文' }, limit: 51 },
    { search: { query: '正文' }, afterSeq: 0 },
    { search: { query: '正文' }, beforeSeq: 7 },
    { search: { query: '正文', ignored: true } },
  ])('拒绝无效搜索或混用普通历史游标 #%#', (input) => {
    expect(ProjectChatHistoryRequestSchema.safeParse({ projectId, ...input }).success).toBe(false);
  });

  it('普通历史的双向游标和200条上界不变', () => {
    const input = { projectId, afterSeq: 0, beforeSeq: 8, limit: 200 };
    expect(ProjectChatHistoryRequestSchema.parse(input)).toEqual(input);
    expect(ProjectChatHistoryResultSchema.parse({ ok: true, messages: [] })).toEqual({
      ok: true,
      messages: [],
    });
  });

  it('搜索分页元数据通过响应边界，空串游标不被当作成功页', () => {
    const result = { ok: true, messages: [], searchPage: { nextCursor: null } };
    expect(ProjectChatHistoryResultSchema.parse(result)).toEqual(result);
    expect(
      ProjectChatHistoryResultSchema.safeParse({
        ...result,
        searchPage: { nextCursor: '' },
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { projectDictionaryBindingState } from '../../../../../stratex/shared/protocol/project-collab-dictionaries.js';

import {
  mapProjectAssetCatalogueEntry,
  mapProjectAssetVersion,
  mapProjectAssetVersionChain,
  mapProjectAssetVersionResolution,
  mapProjectFileAsset,
  mapTodo,
  readServerErrorCode,
} from '../../../../../stratex/main/services/collab/collabWireMapping.js';

describe('readServerErrorCode', () => {
  it('挑出合法的服务端业务码（小写起头 snake_case）', () => {
    expect(readServerErrorCode({ error: 'invitation_revoked' })).toBe('invitation_revoked');
    expect(readServerErrorCode({ error: 'invitation_exhausted', detail: '给人看的文案' })).toBe(
      'invitation_exhausted',
    );
    // 单字符与恰好 64 字符都在闭集内。
    expect(readServerErrorCode({ error: 'x' })).toBe('x');
    expect(readServerErrorCode({ error: 'a'.repeat(64) })).toBe('a'.repeat(64));
  });

  it('形状不合的 error 一律不带回（undefined）', () => {
    // 大写 / 空格 / 数字起头 / 下划线起头 / 空串 / 超长。
    for (const bad of ['Invitation', 'has space', '1leading', '_leading', '', 'a'.repeat(65)]) {
      expect(readServerErrorCode({ error: bad })).toBeUndefined();
    }
    // error 不是字符串。
    expect(readServerErrorCode({ error: 42 })).toBeUndefined();
    expect(readServerErrorCode({ error: null })).toBeUndefined();
    expect(readServerErrorCode({ error: { nested: 'x' } })).toBeUndefined();
  });

  it('非对象体 / 缺 error 键 → undefined（只挑 error，绝不夹带其它字段）', () => {
    expect(readServerErrorCode(undefined)).toBeUndefined();
    expect(readServerErrorCode(null)).toBeUndefined();
    expect(readServerErrorCode('invitation_revoked')).toBeUndefined();
    expect(readServerErrorCode(['invitation_revoked'])).toBeUndefined();
    expect(readServerErrorCode(42)).toBeUndefined();
    // detail 是自由文案，不是业务码：绝不当 serverCode 挑出来。
    expect(readServerErrorCode({ detail: '说明' })).toBeUndefined();
  });
});

const SHA_A = 'a'.repeat(64);

const SHA_B = 'b'.repeat(64);
const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function versionWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VERSION_ID,
    asset_id: ASSET_ID,
    version_no: 1,
    file_id: FILE_ID,
    content_sha256: SHA_A,
    bytes: 2048,
    filename: '方案.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    source: 'manual',
    author_subject: 'u-bob',
    author_display_name: '鲍勃',
    created_at: '2026-09-11T10:00:00Z',
    content_deleted_at: null,
    ...overrides,
  };
}

function assetWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ASSET_ID,
    project_id: PROJECT_ID,
    current_version_id: VERSION_ID,
    version_count: 1,
    created_by_subject: 'u-bob',
    created_at: '2026-09-11T10:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('mapProjectAssetVersion', () => {
  it('snake_case → camelCase 逐字段投影，冻结副本原样带出', () => {
    expect(mapProjectAssetVersion(versionWire())).toEqual({
      id: VERSION_ID,
      assetId: ASSET_ID,
      versionNo: 1,
      fileId: FILE_ID,
      contentSha256: SHA_A,
      bytes: 2048,
      filename: '方案.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source: 'manual',
      authorSubject: 'u-bob',
      authorDisplayName: '鲍勃',
      createdAt: '2026-09-11T10:00:00Z',
      contentDeletedAt: null,
    });
  });

  it('⭐ 字节已删时把 contentDeletedAt 原样带出（明确反馈，不悄悄说成还在）', () => {
    const mapped = mapProjectAssetVersion(
      versionWire({ content_deleted_at: '2026-09-11T12:00:00Z' }),
    );
    expect(mapped?.contentDeletedAt).toBe('2026-09-11T12:00:00Z');
  });

  it('⛔ 服务端后续新增的字段进不了投影（逐字段挑选）', () => {
    const mapped = mapProjectAssetVersion(
      versionWire({ storage_rel_path: 'ab/secret', account_key: 'leak' }),
    );
    expect(mapped).not.toBeNull();
    expect(Object.keys(mapped as object)).not.toContain('storageRelPath');
    expect(Object.keys(mapped as object)).not.toContain('accountKey');
  });

  it('形状不合一律 null：非对象 / 缺键 / 坏指纹 / 序号为 0 或负', () => {
    expect(mapProjectAssetVersion(null)).toBeNull();
    expect(mapProjectAssetVersion('x')).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ content_sha256: undefined }))).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ content_sha256: 'ABC' }))).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ version_no: 0 }))).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ version_no: -1 }))).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ version_no: 1.5 }))).toBeNull();
    expect(mapProjectAssetVersion(versionWire({ id: 'not-a-uuid' }))).toBeNull();
  });

  it('⛔ content_deleted_at 缺键判整条不可信（不补 null）', () => {
    // 与 mapProjectFile 给 source 补默认的取舍相反：删除状态错了会误导用户去点一次
    // 注定失败的下载，而来源徽标缺席只是少个标。代价不对称 ⇒ 取舍相反。
    expect(mapProjectAssetVersion(versionWire({ content_deleted_at: undefined }))).toBeNull();
  });

  it('⭐ 版本号不设上界：极大的服务端计数照旧映射得出', () => {
    // 这一条盯的是「有人顺手给服务端计数加 .max(N)」——那会让第 N+1 版之后整条链
    // 因为 mapArray 一条坏全批坏而取不回来，表现是「列表空白」。
    for (const versionNo of [500, 501, 10_000, 1_000_000]) {
      expect(mapProjectAssetVersion(versionWire({ version_no: versionNo }))?.versionNo).toBe(
        versionNo,
      );
    }
  });
});

describe('mapProjectFileAsset', () => {
  it('指针与软删标记原样带出；无版本时指针为 null', () => {
    expect(mapProjectFileAsset(assetWire())?.currentVersionId).toBe(VERSION_ID);
    expect(
      mapProjectFileAsset(assetWire({ current_version_id: null, version_count: 0 }))
        ?.currentVersionId,
    ).toBeNull();
    expect(mapProjectFileAsset(assetWire({ deleted_at: '2026-09-11T13:00:00Z' }))?.deletedAt).toBe(
      '2026-09-11T13:00:00Z',
    );
  });

  it('⭐ 版本计数不设上界', () => {
    for (const count of [500, 501, 250_000]) {
      expect(mapProjectFileAsset(assetWire({ version_count: count }))?.versionCount).toBe(count);
    }
  });

  it('缺 version_count 或 project_id 一律 null', () => {
    expect(mapProjectFileAsset(assetWire({ version_count: undefined }))).toBeNull();
    expect(mapProjectFileAsset(assetWire({ project_id: undefined }))).toBeNull();
  });
});

describe('mapProjectAssetCatalogueEntry', () => {
  it('血统 + 内嵌当前版本', () => {
    const entry = mapProjectAssetCatalogueEntry({
      ...assetWire(),
      current_version: versionWire(),
    });
    expect(entry?.currentVersion?.id).toBe(VERSION_ID);
  });

  it('current_version 为 null（还没有版本）是正常出参', () => {
    const entry = mapProjectAssetCatalogueEntry({
      ...assetWire({ current_version_id: null, version_count: 0 }),
      current_version: null,
    });
    expect(entry).not.toBeNull();
    expect(entry?.currentVersion).toBeNull();
  });

  it('⛔ 内嵌当前版本存在但投影不过 ⇒ 整条 null，不降级成「还没有版本」', () => {
    const entry = mapProjectAssetCatalogueEntry({
      ...assetWire(),
      current_version: versionWire({ content_sha256: 'bad' }),
    });
    expect(entry).toBeNull();
  });
});

describe('mapProjectAssetVersionChain', () => {
  it('整条链按服务端给的序原样带出（客户端不重排）', () => {
    const second = versionWire({
      id: '55555555-5555-4555-8555-555555555555',
      version_no: 2,
      content_sha256: SHA_B,
    });
    const chain = mapProjectAssetVersionChain({
      asset: assetWire({ current_version_id: second.id, version_count: 2 }),
      versions: [second, versionWire()],
    });
    expect(chain?.versions.map((version) => version.versionNo)).toEqual([2, 1]);
    expect(chain?.versions.map((version) => version.contentSha256)).toEqual([SHA_B, SHA_A]);
  });

  it('⭐ 长链不被任何上界截断也不整批失败', () => {
    const versions = Array.from({ length: 600 }, (_unused, index) =>
      versionWire({
        id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`,
        version_no: index + 1,
      }),
    );
    const chain = mapProjectAssetVersionChain({
      asset: assetWire({ version_count: 600 }),
      versions,
    });
    expect(chain?.versions).toHaveLength(600);
  });

  it('任一版不可信即整条 null（不做部分采信）', () => {
    const chain = mapProjectAssetVersionChain({
      asset: assetWire({ version_count: 2 }),
      versions: [versionWire(), versionWire({ version_no: 'two' })],
    });
    expect(chain).toBeNull();
  });

  it('缺 asset 或 versions 不是数组一律 null', () => {
    expect(mapProjectAssetVersionChain({ versions: [versionWire()] })).toBeNull();
    expect(mapProjectAssetVersionChain({ asset: assetWire(), versions: {} })).toBeNull();
  });
});

describe('mapProjectAssetVersionResolution', () => {
  it('⭐ 冻结引用解析：带回那一版 + 血统当前状态（可能已删）', () => {
    const resolved = mapProjectAssetVersionResolution({
      asset: assetWire({
        current_version_id: '77777777-7777-4777-8777-777777777777',
        version_count: 3,
        deleted_at: '2026-09-11T14:00:00Z',
      }),
      version: versionWire(),
    });
    // 引用读到的是自己那一版，而当前版本已经是别人了——两件事同时说得出来。
    expect(resolved?.version.id).toBe(VERSION_ID);
    expect(resolved?.version.versionNo).toBe(1);
    expect(resolved?.asset.currentVersionId).not.toBe(VERSION_ID);
    expect(resolved?.asset.deletedAt).toBe('2026-09-11T14:00:00Z');
  });

  it('任一侧不可信即 null', () => {
    expect(
      mapProjectAssetVersionResolution({ asset: assetWire(), version: { id: VERSION_ID } }),
    ).toBeNull();
    expect(
      mapProjectAssetVersionResolution({ asset: { id: ASSET_ID }, version: versionWire() }),
    ).toBeNull();
    expect(mapProjectAssetVersionResolution(null)).toBeNull();
  });
});

describe('mapTodo 的归类与排期投影（三态不塌缩）', () => {
  it('创建人独立于处理人映射；旧服务端不伪造创建人', () => {
    expect(
      mapTodo(wireTodo({ creator_subject: 'u-owner', creator_display_name: '创建人' })),
    ).toMatchObject({ creatorSubject: 'u-owner', creatorDisplayName: '创建人' });
    expect(mapTodo(wireTodo())?.creatorSubject).toBeUndefined();
    expect(mapTodo(wireTodo({ creator_subject: 42 }))).toBeNull();
  });
  const TODO_ID = '5b8e3c21-0000-4000-8000-000000000031';
  const MODULE_ID = '5b8e3c21-0000-4000-8000-000000000032';
  const CATEGORY_ID = '5b8e3c21-0000-4000-8000-000000000033';
  const ITERATION_ID = '5b8e3c21-0000-4000-8000-000000000034';

  function wireTodo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: TODO_ID,
      item_kind: 'requirement',
      parent_id: null,
      source: 'manual',
      visibility: 'shared',
      title: '整理联调纪要',
      status: 'inProgress',
      assignee_kind: 'member',
      assignee_subject: null,
      assignee_display_name: null,
      priority: 'high',
      labels: [],
      start_at: null,
      due_at: null,
      description: '',
      session_ref: null,
      refs: [],
      constraints_text: '',
      acceptance_total: 0,
      acceptance_checked: 0,
      child_total: 0,
      child_done: 0,
      version: 1,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('旧服务端（这几个键根本不回）投影成 absent，不是 uncategorized', () => {
    // ⭐【判据 1 的关键一条】这是本函数里唯一不做 `?? null` 兜底的地方。兜了就等于
    //    替旧服务端宣布「这条没归类」——把一个未知说成一个事实。
    const todo = mapTodo(wireTodo());
    expect(todo).not.toBeNull();
    expect(projectDictionaryBindingState(todo?.moduleId)).toBe('absent');
    expect(projectDictionaryBindingState(todo?.categoryId)).toBe('absent');
    expect(projectDictionaryBindingState(todo?.iterationId)).toBe('absent');
    expect(todo?.module).toBeUndefined();
    expect(todo?.iteration).toBeUndefined();
  });

  it('新服务端回空值投影成 uncategorized（与 absent 分得开）', () => {
    const todo = mapTodo(
      wireTodo({
        module_id: null,
        module: null,
        category_id: null,
        category: null,
        iteration_id: null,
        iteration: null,
      }),
    );
    expect(projectDictionaryBindingState(todo?.moduleId)).toBe('uncategorized');
    expect(projectDictionaryBindingState(todo?.iterationId)).toBe('uncategorized');
    expect(todo?.module).toBeNull();
    expect(todo?.iteration).toBeNull();
  });

  it('需求专属子任务统计：requirement_task_total present → 数字，不设上界', () => {
    for (const total of [0, 7, 500, 10_000]) {
      expect(mapTodo(wireTodo({ requirement_task_total: total }))?.requirementTaskTotal).toBe(
        total,
      );
    }
  });

  it('⛔ 缺 requirement_task_total（旧服务端 / detail 路径不回）⇒ 缺席，不兜成 0', () => {
    expect(mapTodo(wireTodo())?.requirementTaskTotal).toBeUndefined();
  });

  it('requirement_task_total 形状不合 ⇒ 整条 null（mapArray 一条坏全批坏）', () => {
    expect(mapTodo(wireTodo({ requirement_task_total: 'seven' }))).toBeNull();
    expect(mapTodo(wireTodo({ requirement_task_total: -1 }))).toBeNull();
    expect(mapTodo(wireTodo({ requirement_task_total: 1.5 }))).toBeNull();
  });

  it('时间事实面：status_changed_at / actual_completed_at 有值时原样带出', () => {
    const todo = mapTodo(
      wireTodo({
        status_changed_at: '2026-09-10T08:00:00.000Z',
        actual_completed_at: '2026-09-10T09:30:00.000Z',
      }),
    );
    expect(todo?.statusChangedAt).toBe('2026-09-10T08:00:00.000Z');
    expect(todo?.actualCompletedAt).toBe('2026-09-10T09:30:00.000Z');
  });

  it('⭐【判据 1 的关键一条】缺席（undefined）与显式 null 分得开，⛔ 不兜成 null', () => {
    // 缺席 ＝ 旧服务端（0023 之前）根本不回这两个键；null ＝ 新服务端回了、是空
    // （statusChangedAt「早于 0023，未知」/ actualCompletedAt「当前没有通过」）。
    // 兜成 null 就是把「旧服务端没回」说成「这条从没通过过」——一个未知冒充一个事实。
    const absent = mapTodo(wireTodo());
    expect(absent?.statusChangedAt).toBeUndefined();
    expect(absent?.actualCompletedAt).toBeUndefined();

    const empty = mapTodo(wireTodo({ status_changed_at: null, actual_completed_at: null }));
    expect(empty?.statusChangedAt).toBeNull();
    expect(empty?.actualCompletedAt).toBeNull();
  });

  it('时间事实形状不合 ⇒ 整条 null（mapArray 一条坏全批坏）', () => {
    // 非字符串、或超 64 字长（与 timestampSchema 同界）都判整条不可信。
    expect(mapTodo(wireTodo({ status_changed_at: 12345 }))).toBeNull();
    expect(mapTodo(wireTodo({ actual_completed_at: 'x'.repeat(65) }))).toBeNull();
  });

  it('绑定了就带回引用摘要（snake→camel，含已归档标记）', () => {
    const todo = mapTodo(
      wireTodo({
        module_id: MODULE_ID,
        module: { id: MODULE_ID, name: '成员与权限', archived_at: null },
        category_id: CATEGORY_ID,
        category: {
          id: CATEGORY_ID,
          name: '技术债',
          archived_at: '2026-09-02T00:00:00.000Z',
        },
      }),
    );
    expect(todo?.moduleId).toBe(MODULE_ID);
    expect(todo?.module).toEqual({ id: MODULE_ID, name: '成员与权限', archivedAt: null });
    expect(todo?.category?.archivedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('迭代摘要带 dueAt；字典摘要**不带**它（两种形状不混用）', () => {
    const todo = mapTodo(
      wireTodo({
        iteration_id: ITERATION_ID,
        iteration: {
          id: ITERATION_ID,
          name: '第一轮',
          due_at: '2026-09-30T00:00:00.000Z',
          archived_at: null,
        },
      }),
    );
    expect(todo?.iteration).toEqual({
      id: ITERATION_ID,
      name: '第一轮',
      dueAt: '2026-09-30T00:00:00.000Z',
      archivedAt: null,
    });
    // 把迭代摘要（带 due_at）塞进字典位 ⇒ 整条拒（strictObject 多一个键）。
    expect(
      mapTodo(
        wireTodo({
          module_id: MODULE_ID,
          module: {
            id: MODULE_ID,
            name: '模块',
            due_at: '2026-09-30T00:00:00.000Z',
            archived_at: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it('摘要形状坏掉时整条拒（不做部分采信）', () => {
    // ⚠️ 与「计数字段不设上界」是同一条纪律的另一面：不可信的响应不部分采信，
    //    但上界那种**服务端说了算**的数字一律不设客户端天花板。
    expect(mapTodo(wireTodo({ module_id: MODULE_ID, module: { id: MODULE_ID } }))).toBeNull();
    expect(mapTodo(wireTodo({ module_id: 'not-a-uuid' }))).toBeNull();
  });

  it('归类字段不给服务端计数设上界（一条坏全批坏的老账）', () => {
    // 字典条目名称有上界（与 DDL 同界），但**计数类字段一个都没有新增**——
    // 这条钉的是「别顺手给来自服务端的数字加 .max()」。
    const huge = mapTodo(wireTodo({ child_total: 10_000, child_done: 9_999 }));
    expect(huge?.childTotal).toBe(10_000);
  });
});

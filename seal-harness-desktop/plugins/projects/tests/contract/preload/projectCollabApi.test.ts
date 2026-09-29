import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectCollabPreloadApi, type ProjectCollabInvoke } from '../../../stratex/preload/projectCollabApi.js';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';

describe('project submission gate preload contract', () => {
  it('forwards the row version and rejects extra safety switches', async () => {
    const submissionGate = {
      requireTasks: true,
      requireAllTasksDone: false,
      requireCriteria: true,
      requireReadyArtifacts: true,
    };
    const result = { ok: true, gate: { submissionGate, gateVersion: 2, ruleVersion: 9 } };
    const invoke = vi.fn<ProjectCollabInvoke>(async () => result);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.readProjectSubmissionGate({ projectId: OPERATION_ID })).resolves.toEqual(
      result,
    );
    await expect(
      api.updateProjectSubmissionGate({
        projectId: OPERATION_ID,
        submissionGate,
        expectedVersion: 9,
      }),
    ).resolves.toEqual(result);
    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_SUBMISSION_GATE_GET, { projectId: OPERATION_ID }],
      [
        IPC.PROJECT_SUBMISSION_GATE_UPDATE,
        { projectId: OPERATION_ID, submissionGate, expectedVersion: 9 },
      ],
    ]);
    await expect(
      api.updateProjectSubmissionGate({
        projectId: OPERATION_ID,
        submissionGate: { ...submissionGate, skipSafety: true },
        expectedVersion: 9,
      } as never),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(2);
    invoke.mockResolvedValueOnce({
      ok: true,
      gate: { ...result.gate, privateToken: 'unexpected' },
    });
    await expect(api.readProjectSubmissionGate({ projectId: OPERATION_ID })).rejects.toThrow();
  });
});

describe('project collab preload upload lifecycle', () => {
  it('validates cancellation and drops progress payloads that leak a path', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    let subscribed: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const api = createProjectCollabPreloadApi(invoke, (channel, listener) => {
      expect(channel).toBe(IPC.PROJECT_FILE_UPLOAD_PROGRESS);
      subscribed = listener;
      return unsubscribe;
    });
    const listener = vi.fn();
    const stop = api.onProjectFileUploadProgress(listener);

    subscribed?.({
      operationId: OPERATION_ID,
      name: 'report.docx',
      size: 20,
      progress: 10,
      phase: 'uploading',
      error: null,
    });
    subscribed?.({
      operationId: OPERATION_ID,
      name: 'report.docx',
      size: 20,
      progress: 10,
      phase: 'uploading',
      error: null,
      path: 'C:\\private\\report.docx',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).not.toHaveProperty('path');
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();

    await expect(api.cancelProjectFileUpload({ operationId: OPERATION_ID })).resolves.toEqual({
      ok: true,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_FILE_UPLOAD_CANCEL, {
      operationId: OPERATION_ID,
    });
  });
});

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

describe('project collab preload 开放邀请通道', () => {
  it('list/revoke 走各自通道且入参经 schema 收敛', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_LIST_OPEN_INVITATIONS
        ? { ok: true, invitations: [] }
        : { ok: true, projectId: PROJECT_ID, invitationId: INVITATION_ID },
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.listProjectOpenInvitations({ projectId: PROJECT_ID })).resolves.toEqual({
      ok: true,
      invitations: [],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_LIST_OPEN_INVITATIONS, {
      projectId: PROJECT_ID,
    });

    await expect(api.revokeProjectInvitation({ invitationId: INVITATION_ID })).resolves.toEqual({
      ok: true,
      projectId: PROJECT_ID,
      invitationId: INVITATION_ID,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REVOKE_INVITATION, {
      invitationId: INVITATION_ID,
    });
  });

  it('onProjectJoinLink 丢弃形状不合规的帧（坏 code 不进渲染层）', () => {
    let subscribed: ((payload: unknown) => void) | undefined;
    const api = createProjectCollabPreloadApi(
      vi.fn<ProjectCollabInvoke>(async () => ({})),
      (channel, listener) => {
        expect(channel).toBe(IPC.PROJECT_JOIN_LINK);
        subscribed = listener;
        return () => undefined;
      },
    );
    const listener = vi.fn();
    api.onProjectJoinLink(listener);
    subscribed?.({ code: 'abcdefgh12345678' });
    subscribed?.({ code: 'has space!!' }); // 坏 code：丢弃
    subscribed?.({ code: 'abcdefgh12345678', projectId: PROJECT_ID }); // 夹带字段：丢弃
    expect(listener).toHaveBeenCalledExactlyOnceWith({ code: 'abcdefgh12345678' });
  });
});

const MILESTONE_ID = '55555555-5555-4555-8555-555555555555';
const ITERATION_ID = '66666666-6666-4666-8666-666666666666';

describe('project collab preload 规划域通道', () => {
  it('六条各走各的通道，入参经 schema 收敛后原样递交', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) => {
      if (channel === IPC.PROJECT_MILESTONE_LIST) {
        return { ok: true, items: [], total: 0, page: 1, pageSize: 20 };
      }
      if (channel === IPC.PROJECT_ITERATION_LIST) {
        return {
          ok: true,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          groupCounts: { mine: 0, open: 0, completed: 0 },
        };
      }
      return {
        ok: false,
        code: 'transient',
        message: '网络暂时不可用，请稍后重试。',
        referenceCode: 'STRX-COLLAB-010',
        ...(channel === IPC.PROJECT_MILESTONE_UPDATE || channel === IPC.PROJECT_ITERATION_UPDATE
          ? { currentVersion: null }
          : {}),
      };
    });
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.listProjectMilestones({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
      total: 0,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_MILESTONE_LIST, { projectId: PROJECT_ID });

    await api.listProjectIterations({ projectId: PROJECT_ID, unlinked: true });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ITERATION_LIST, {
      projectId: PROJECT_ID,
      unlinked: true,
    });

    await api.createProjectMilestone({
      projectId: PROJECT_ID,
      clientRequestId: 'req-1',
      name: '成员邀请与权限管理',
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_MILESTONE_CREATE, {
      projectId: PROJECT_ID,
      clientRequestId: 'req-1',
      name: '成员邀请与权限管理',
    });

    await api.updateProjectMilestone({
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 2,
      clientRequestId: 'req-2',
      archived: true,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_MILESTONE_UPDATE, {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
      expectedVersion: 2,
      clientRequestId: 'req-2',
      archived: true,
    });

    await api.createProjectIteration({
      projectId: PROJECT_ID,
      clientRequestId: 'req-3',
      name: '第一轮',
      milestoneId: null,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ITERATION_CREATE, {
      projectId: PROJECT_ID,
      clientRequestId: 'req-3',
      name: '第一轮',
      milestoneId: null,
    });

    await api.updateProjectIteration({
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 1,
      clientRequestId: 'req-4',
      priority: 'high',
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ITERATION_UPDATE, {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
      expectedVersion: 1,
      clientRequestId: 'req-4',
      priority: 'high',
    });
  });
});

describe('project collab preload 规划域生命周期六条（MIL-07）', () => {
  const failure = {
    ok: false,
    code: 'conflict',
    message: '内容已被他人更新，请刷新后重试。',
    referenceCode: 'STRX-COLLAB-006',
    serverCode: 'milestone_has_open_rounds',
    currentVersion: null,
  } as const;
  const lifecycle = {
    expectedVersion: 2,
    clientRequestId: 'req-life-1',
    reason: '三条验收用例全部通过',
    evidenceRefs: ['todo:77777777-7777-4777-8777-777777777777'],
  };

  it('四条写动作各走各的通道，入参经 schema 收敛后原样递交，失败信封原样校验', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => failure);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const milestone = { projectId: PROJECT_ID, milestoneId: MILESTONE_ID, ...lifecycle };
    const iteration = { projectId: PROJECT_ID, iterationId: ITERATION_ID, ...lifecycle };

    await expect(api.completeProjectMilestone(milestone)).resolves.toEqual(failure);
    await api.reopenProjectMilestone(milestone);
    await api.completeProjectIteration(iteration);
    await api.reopenProjectIteration(iteration);

    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_MILESTONE_COMPLETE, milestone],
      [IPC.PROJECT_MILESTONE_REOPEN, milestone],
      [IPC.PROJECT_ITERATION_COMPLETE, iteration],
      [IPC.PROJECT_ITERATION_REOPEN, iteration],
    ]);
  });

  it('桥挡掉不合形状的入参（账号字段 / 证据塞正文），一次都不 invoke', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => failure);
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const iteration = { projectId: PROJECT_ID, iterationId: ITERATION_ID, ...lifecycle };

    await expect(
      api.completeProjectIteration({ ...iteration, accountKey: 'acc-1' } as never),
    ).rejects.toThrow();
    await expect(
      api.completeProjectIteration({ ...iteration, evidenceRefs: ['验收截图'] }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('两条阶段记录走各自通道，出参按契约校验（越出服务端契约即拒，含空白的引用照收）', async () => {
    const record = {
      id: '88888888-8888-4888-8888-888888888888',
      iterationId: ITERATION_ID,
      fromStatus: 'open',
      toStatus: 'completed',
      actorSubject: 'u-alice',
      reason: '三条验收用例全部通过',
      // 服务端写得进的引用（非空、≤256）读侧照收，⛔ 不因不合 token 形状整页拒。
      evidenceRefs: ['验收记录 第二版'],
      occurredAt: '2026-09-05T08:00:00Z',
    };
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_ITERATION_EVENTS
        ? { ok: true, items: [record], total: 1, page: 1, pageSize: 100 }
        : { ok: true, items: [{ ...record, toStatus: 'done' }], total: 1, page: 1, pageSize: 100 },
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(
      api.listProjectIterationEvents({ projectId: PROJECT_ID, iterationId: ITERATION_ID }),
    ).resolves.toMatchObject({
      ok: true,
      items: [{ reason: '三条验收用例全部通过', evidenceRefs: ['验收记录 第二版'] }],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ITERATION_EVENTS, {
      projectId: PROJECT_ID,
      iterationId: ITERATION_ID,
    });
    await expect(
      api.listProjectMilestoneEvents({ projectId: PROJECT_ID, milestoneId: MILESTONE_ID }),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_MILESTONE_EVENTS, {
      projectId: PROJECT_ID,
      milestoneId: MILESTONE_ID,
    });
  });

  it('证据里的外部链接（ADR-0036）：写入前收 link:https，桥上拒 link:javascript；打开走专用通道', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_EVIDENCE_LINK_OPEN ? { ok: true } : failure,
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const iteration = { projectId: PROJECT_ID, iterationId: ITERATION_ID, ...lifecycle };
    const withLink = { ...iteration, evidenceRefs: ['link:https://example.com/report?id=7'] };

    await api.completeProjectIteration(withLink);
    await expect(
      api.completeProjectIteration({ ...iteration, evidenceRefs: ['link:javascript:void'] }),
    ).rejects.toThrow();
    await expect(
      api.openProjectEvidenceLink({ url: 'https://example.com/report?id=7' }),
    ).resolves.toEqual({ ok: true });

    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_ITERATION_COMPLETE, withLink],
      [IPC.PROJECT_EVIDENCE_LINK_OPEN, { url: 'https://example.com/report?id=7' }],
    ]);
  });
});

const ASSET_ID = '55555555-5555-4555-8555-555555555555';
const VERSION_ID = '66666666-6666-4666-8666-666666666666';
const FILE_ID = '77777777-7777-4777-8777-777777777777';

describe('project collab preload 资产版本十条', () => {
  const asset = {
    id: ASSET_ID,
    projectId: PROJECT_ID,
    currentVersionId: VERSION_ID,
    versionCount: 1,
    createdBySubject: 'user-alice',
    createdAt: '2026-09-12T08:00:00.000Z',
    deletedAt: null,
  };
  const version = {
    id: VERSION_ID,
    assetId: ASSET_ID,
    versionNo: 1,
    fileId: FILE_ID,
    contentSha256: 'a'.repeat(64),
    bytes: 2048,
    filename: '本周工作总结.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    source: 'manual',
    authorSubject: 'user-alice',
    authorDisplayName: '张三',
    createdAt: '2026-09-12T08:00:00.000Z',
    contentDeletedAt: null,
  };

  it('十条各走自己的通道，入参经 schema 收敛（⛔ 塞不进路径与账号）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) => {
      if (channel === IPC.PROJECT_ASSET_LIST) {
        return { ok: true, assets: [{ ...asset, currentVersion: version }] };
      }
      if (channel === IPC.PROJECT_ASSET_VERSION_LIST) {
        return { ok: true, asset, versions: [version] };
      }
      if (channel === IPC.PROJECT_ASSET_VERSION_RESOLVE) return { ok: true, asset, version };
      if (channel === IPC.PROJECT_ASSET_VERSION_REGISTER) {
        return { ok: true, asset, version, reused: false };
      }
      if (channel === IPC.PROJECT_ASSET_DELETE) return { ok: true, id: ASSET_ID };
      if (channel === IPC.PROJECT_ASSET_VERSION_UPLOAD) {
        return { ok: true, asset, version, reused: false };
      }
      if (channel === IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME) {
        return { ok: true, asset, version, reused: true };
      }
      if (channel === IPC.PROJECT_ASSET_VERSION_PREVIEW) {
        return { ok: true, asset, version, preview: { kind: 'fallback', reason: 'oversize' } };
      }
      return { ok: true };
    });
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.listProjectAssets({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      api.listProjectAssetVersions({ projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).resolves.toMatchObject({ ok: true });
    await expect(api.resolveProjectAssetVersion({ versionId: VERSION_ID })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      api.registerProjectAssetVersion({ projectId: PROJECT_ID, fileId: FILE_ID }),
    ).resolves.toMatchObject({ ok: true, reused: false });
    await expect(
      api.deleteProjectAsset({ projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).resolves.toEqual({ ok: true, id: ASSET_ID });
    await expect(
      api.uploadProjectAssetVersion({ projectId: PROJECT_ID, operationId: OPERATION_ID }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      api.resumeProjectAssetVersionUpload({ operationId: OPERATION_ID }),
    ).resolves.toMatchObject({ ok: true, reused: true });
    await expect(
      api.cancelProjectAssetVersionUpload({ operationId: OPERATION_ID }),
    ).resolves.toEqual({ ok: true });
    await expect(
      api.discardProjectAssetVersionUpload({ operationId: OPERATION_ID }),
    ).resolves.toEqual({ ok: true });
    await expect(
      api.previewProjectAssetVersion({ versionId: VERSION_ID, block: 2 }),
    ).resolves.toMatchObject({ ok: true, preview: { kind: 'fallback', reason: 'oversize' } });

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IPC.PROJECT_ASSET_LIST,
      IPC.PROJECT_ASSET_VERSION_LIST,
      IPC.PROJECT_ASSET_VERSION_RESOLVE,
      IPC.PROJECT_ASSET_VERSION_REGISTER,
      IPC.PROJECT_ASSET_DELETE,
      IPC.PROJECT_ASSET_VERSION_UPLOAD,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_RESUME,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_CANCEL,
      IPC.PROJECT_ASSET_VERSION_UPLOAD_DISCARD,
      IPC.PROJECT_ASSET_VERSION_PREVIEW,
    ]);
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ASSET_VERSION_PREVIEW, {
      versionId: VERSION_ID,
      block: 2,
    });
  });

  it('⛔ 入参里夹带本机路径/账号一律在桥上就被拒（不发出去）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(
      api.uploadProjectAssetVersion({
        projectId: PROJECT_ID,
        operationId: OPERATION_ID,
        filePath: 'C:\private\a.docx',
      } as never),
    ).rejects.toThrow();
    await expect(
      api.listProjectAssets({ projectId: PROJECT_ID, accountKey: 'leak' } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ 出参形状不对也在桥上拒（坏帧不进渲染层）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: true,
      asset,
      version,
      // 既不是 text 也不是 fallback 的第三态：桥必须拒。
      preview: { kind: 'blank' },
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.previewProjectAssetVersion({ versionId: VERSION_ID })).rejects.toThrow();
  });
});

describe('project collab preload 资产回收站与两类恢复（RPT-08）', () => {
  const asset = {
    id: ASSET_ID,
    projectId: PROJECT_ID,
    currentVersionId: VERSION_ID,
    versionCount: 2,
    createdBySubject: 'user-alice',
    createdAt: '2026-09-12T08:00:00.000Z',
    deletedAt: '2026-09-12T09:00:00.000Z',
  };
  const version = {
    id: VERSION_ID,
    assetId: ASSET_ID,
    versionNo: 2,
    fileId: FILE_ID,
    contentSha256: 'b'.repeat(64),
    bytes: 1024,
    filename: '验收报告.pdf',
    mime: 'application/pdf',
    source: 'manual',
    authorSubject: 'user-alice',
    authorDisplayName: '张三',
    createdAt: '2026-09-12T08:30:00.000Z',
    contentDeletedAt: null,
  };

  it('三条各走自己的通道，出参在桥上校验（失败体的业务码与 quota 原样过桥）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) => {
      if (channel === IPC.PROJECT_ASSET_TRASH_LIST) {
        return { ok: true, assets: [{ ...asset, currentVersion: version }] };
      }
      if (channel === IPC.PROJECT_ASSET_RESTORE) {
        return { ok: true, asset: { ...asset, deletedAt: null, currentVersion: version } };
      }
      return {
        ok: false,
        code: 'conflict',
        message: '资产版本已被他人更新，请刷新后重试。',
        referenceCode: 'STRX-COLLAB-006',
        serverCode: 'asset_deleted',
        quota: null,
      };
    });
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.listProjectAssetTrash({ projectId: PROJECT_ID })).resolves.toMatchObject({
      ok: true,
      assets: [{ id: ASSET_ID }],
    });
    await expect(
      api.restoreProjectAsset({ projectId: PROJECT_ID, assetId: ASSET_ID }),
    ).resolves.toMatchObject({ ok: true, asset: { deletedAt: null } });
    await expect(
      api.restoreProjectAssetVersion({ projectId: PROJECT_ID, versionId: VERSION_ID }),
    ).resolves.toMatchObject({ ok: false, serverCode: 'asset_deleted', quota: null });

    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_ASSET_TRASH_LIST, { projectId: PROJECT_ID }],
      [IPC.PROJECT_ASSET_RESTORE, { projectId: PROJECT_ID, assetId: ASSET_ID }],
      [IPC.PROJECT_ASSET_VERSION_RESTORE, { projectId: PROJECT_ID, versionId: VERSION_ID }],
    ]);
  });

  it('⛔ 入参夹带账号或多余字段在桥上就被拒（不发出去）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(
      api.listProjectAssetTrash({ projectId: PROJECT_ID, accountKey: 'leak' } as never),
    ).rejects.toThrow();
    await expect(
      api.restoreProjectAssetVersion({
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        fallbackToCurrent: true,
      } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ 历史版本恢复的失败体缺 quota 键 ⇒ 桥上拒（坏帧不进渲染层）', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: false,
      code: 'conflict',
      message: '资产版本已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'asset_deleted',
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(
      api.restoreProjectAssetVersion({ projectId: PROJECT_ID, versionId: VERSION_ID }),
    ).rejects.toThrow();
  });
});

describe('project collab preload 迭代排期整批保存（MIL-06）', () => {
  const SCHEDULE_PROJECT_ID = '77777777-7777-4777-8777-777777777777';
  const SCHEDULE_MILESTONE_ID = '88888888-8888-4888-8888-888888888888';
  const SCHEDULE_ITERATION_ID = '99999999-9999-4999-8999-999999999999';
  const request = {
    projectId: SCHEDULE_PROJECT_ID,
    milestoneId: SCHEDULE_MILESTONE_ID,
    clientRequestId: 'req-schedule-1',
    items: [{ iterationId: SCHEDULE_ITERATION_ID, dueAt: '2026-09-25', expectedVersion: 1 }],
  };

  it('整批请求走一条通道；失败出参的 conflicts 在桥上被校验', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: false,
      code: 'conflict',
      message: '内容已被他人更新，请刷新后重试。',
      referenceCode: 'STRX-COLLAB-006',
      serverCode: 'version_conflict',
      conflicts: [{ iterationId: SCHEDULE_ITERATION_ID, currentVersion: 2 }],
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.saveProjectIterationSchedule(request)).resolves.toMatchObject({
      ok: false,
      conflicts: [{ iterationId: SCHEDULE_ITERATION_ID, currentVersion: 2 }],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_ITERATION_SCHEDULE_SAVE, request);
  });

  it('⛔ 带时分的日期、多带账号字段在桥上就拒，不发 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(
      api.saveProjectIterationSchedule({
        ...request,
        items: [{ ...request.items[0]!, dueAt: '2026-09-25T00:00:00Z' }],
      }),
    ).rejects.toThrow();
    await expect(
      api.saveProjectIterationSchedule({ ...request, accountKey: 'leak' } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('project collab preload 安排需求整批保存与需求排期现状（MIL-09）', () => {
  const ARRANGE_PROJECT_ID = '77777777-7777-4777-8777-777777777777';
  const ARRANGE_MILESTONE_ID = '88888888-8888-4888-8888-888888888888';
  const ARRANGE_ITERATION_ID = '99999999-9999-4999-8999-999999999999';
  const ARRANGE_REQUIREMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const request = {
    projectId: ARRANGE_PROJECT_ID,
    milestoneId: ARRANGE_MILESTONE_ID,
    clientRequestId: 'req-arrange-1',
    items: [
      {
        requirementId: ARRANGE_REQUIREMENT_ID,
        iterationId: ARRANGE_ITERATION_ID,
        expectedRequirementVersion: 1,
        expectedIterationId: null,
      },
    ],
  };

  it('整批保存与排期现状各走一条通道；失败出参的 conflicts 在桥上被校验', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE
        ? {
            ok: false,
            code: 'conflict',
            message: '内容已被他人更新，请刷新后重试。',
            referenceCode: 'STRX-COLLAB-006',
            serverCode: 'version_conflict',
            conflicts: [
              {
                requirementId: ARRANGE_REQUIREMENT_ID,
                currentVersion: 2,
                currentIterationId: ARRANGE_ITERATION_ID,
              },
            ],
          }
        : { ok: true, items: [], total: 0, page: 1, pageSize: 1, unscheduledTotal: 4 },
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.saveProjectRequirementSchedule(request)).resolves.toMatchObject({
      ok: false,
      conflicts: [{ requirementId: ARRANGE_REQUIREMENT_ID, currentVersion: 2 }],
    });
    const listRequest = { projectId: ARRANGE_PROJECT_ID, pageSize: 1 };
    await expect(api.listProjectRequirementPlacements(listRequest)).resolves.toMatchObject({
      ok: true,
      unscheduledTotal: 4,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_SCHEDULE_SAVE, request);
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_PLACEMENT_LIST, listRequest);
  });

  it('⛔ 同一需求出现两次、缺显式 null、多带账号字段在桥上就拒，不发 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    const item = request.items[0]!;
    const missingNull: Record<string, unknown> = { ...item };
    delete missingNull.expectedIterationId;
    for (const bad of [
      { ...request, items: [item, item] },
      { ...request, items: [missingNull] },
      { ...request, accountKey: 'leak' },
    ]) {
      await expect(api.saveProjectRequirementSchedule(bad as never)).rejects.toThrow();
    }
    await expect(
      api.listProjectRequirementPlacements({ projectId: ARRANGE_PROJECT_ID, q: '' }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ Main 回来的成功体形状不对（缺未排条数）在桥上拒收', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(
      api.listProjectRequirementPlacements({ projectId: ARRANGE_PROJECT_ID }),
    ).rejects.toThrow();
  });
});

describe('project collab preload 整需求提测三条（TST-02）', () => {
  const SUBMIT_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
  const SUBMIT_REQUIREMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const SUBMIT_ROUND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const SUBMIT_VERSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const round = {
    id: SUBMIT_ROUND_ID,
    projectId: SUBMIT_PROJECT_ID,
    requirementId: SUBMIT_REQUIREMENT_ID,
    roundNo: 1,
    state: 'queued',
    submittedBySubject: 'u-me',
    reviewerSubject: 'u-other',
    version: 1,
    createdAt: '2026-09-14T08:00:00Z',
    updatedAt: '2026-09-14T08:00:00Z',
    summary: '全部任务已完成。',
  };
  const submitRequest = {
    projectId: SUBMIT_PROJECT_ID,
    requirementId: SUBMIT_REQUIREMENT_ID,
    expectedVersion: 4,
    clientRequestId: 'req-submit-1',
    summary: '全部任务已完成。',
    reviewerSubject: 'u-other',
    artifactVersionIds: [SUBMIT_VERSION_ID],
  };

  it('三条各走自己的通道；失败体的业务码与附加字段原样过桥', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) => {
      if (channel === IPC.PROJECT_REQUIREMENT_SUBMIT) {
        return {
          ok: false,
          code: 'rejected',
          message: '请求被服务端拒绝。',
          referenceCode: 'STRX-COLLAB-009',
          serverCode: 'submission_tasks_unfinished',
          currentVersion: null,
          unfinishedTaskIds: [SUBMIT_REQUIREMENT_ID],
          unfinishedTaskCount: 2,
          legacyOpenReviewCount: null,
        };
      }
      if (channel === IPC.PROJECT_REQUIREMENT_SUBMISSIONS) {
        return { ok: true, submissions: [round], hasMore: false, nextCursor: null };
      }
      return {
        ok: false,
        code: 'rejected',
        message: '请求被服务端拒绝。',
        referenceCode: 'STRX-COLLAB-009',
        serverCode: 'submission_not_found',
      };
    });
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.submitProjectRequirementForTest(submitRequest)).resolves.toMatchObject({
      ok: false,
      serverCode: 'submission_tasks_unfinished',
      unfinishedTaskCount: 2,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_SUBMIT, submitRequest);

    const listRequest = { projectId: SUBMIT_PROJECT_ID, requirementId: SUBMIT_REQUIREMENT_ID };
    await expect(api.listProjectRequirementSubmissions(listRequest)).resolves.toMatchObject({
      ok: true,
      submissions: [{ roundNo: 1 }],
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_SUBMISSIONS, listRequest);

    const detailRequest = { projectId: SUBMIT_PROJECT_ID, submissionId: SUBMIT_ROUND_ID };
    await expect(api.readProjectSubmission(detailRequest)).resolves.toMatchObject({
      ok: false,
      serverCode: 'submission_not_found',
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_SUBMISSION_DETAIL, detailRequest);
  });

  it('⛔ 入参夹带账号 / 快照字段、交付物不是版本 uuid 在桥上就拒，不发 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    for (const bad of [
      { ...submitRequest, accountKey: 'leak' },
      { ...submitRequest, tasksSnapshot: [] },
      { ...submitRequest, artifactVersionIds: ['asset:not-a-version'] },
    ]) {
      await expect(api.submitProjectRequirementForTest(bad as never)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ Main 回来的失败体缺附加键（形状不对）在桥上拒收', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({
      ok: false,
      code: 'rejected',
      message: '请求被服务端拒绝。',
      referenceCode: 'STRX-COLLAB-009',
    }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);
    await expect(api.submitProjectRequirementForTest(submitRequest)).rejects.toThrow();
  });
});

describe('project collab preload 按计划时间段读取（CORE-08，ADR-0042）', () => {
  const WINDOW_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
  const WINDOW = { planFrom: '2026-08-31T00:00:00.000Z', planTo: '2026-10-12T00:00:00.000Z' };

  it('需求分页与目标列表：时间段经 schema 收敛后原样递交；倒挂在 preload 就拒、不进 IPC', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_REQUIREMENT_PAGE
        ? { ok: true, items: [], total: 0, page: 1, pageSize: 20, queryRevision: 'rev' }
        : { ok: true, items: [], total: 0, page: 1, pageSize: 20 },
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await api.listProjectRequirementPage({
      projectId: WINDOW_PROJECT_ID,
      page: 1,
      pageSize: 20,
      ...WINDOW,
    });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_REQUIREMENT_PAGE, {
      projectId: WINDOW_PROJECT_ID,
      page: 1,
      pageSize: 20,
      ...WINDOW,
    });
    await api.listProjectMilestones({ projectId: WINDOW_PROJECT_ID, ...WINDOW });
    expect(invoke).toHaveBeenCalledWith(IPC.PROJECT_MILESTONE_LIST, {
      projectId: WINDOW_PROJECT_ID,
      ...WINDOW,
    });

    const inverted = { planFrom: WINDOW.planTo, planTo: WINDOW.planFrom };
    await expect(
      api.listProjectRequirementPage({
        projectId: WINDOW_PROJECT_ID,
        page: 1,
        pageSize: 20,
        ...inverted,
      }),
    ).rejects.toThrow();
    await expect(
      api.listProjectMilestones({ projectId: WINDOW_PROJECT_ID, ...inverted }),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('project collab preload 项目助理规划草案两条（mil-11，ADR-0045）', () => {
  const SESSION_ID = '55555555-5555-4555-8555-555555555555';
  const DRAFT_ID = '20000000-0000-4000-8000-000000000001';
  const DRAFT = {
    kind: 'milestone',
    draftId: DRAFT_ID,
    projectId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-09-14T08:00:00.000Z',
    name: '数据权限治理',
    objectiveMd: '',
    startAt: null,
    dueAt: null,
    ownerSubject: null,
  };

  it('读取与清除各走自己的通道，入参经 schema 收敛后原样递交，出参按契约校验', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async (channel) =>
      channel === IPC.PROJECT_PLANNING_DRAFT_LIST ? { ok: true, drafts: [DRAFT] } : { ok: true },
    );
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(api.listProjectPlanningDrafts({ sessionId: SESSION_ID })).resolves.toStrictEqual({
      ok: true,
      drafts: [DRAFT],
    });
    expect(invoke).toHaveBeenLastCalledWith(IPC.PROJECT_PLANNING_DRAFT_LIST, {
      sessionId: SESSION_ID,
    });
    await expect(
      api.discardProjectPlanningDraft({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
        outcome: 'confirmed',
      }),
    ).resolves.toStrictEqual({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith(IPC.PROJECT_PLANNING_DRAFT_DISCARD, {
      sessionId: SESSION_ID,
      draftId: DRAFT_ID,
      outcome: 'confirmed',
    });
  });

  it('⛔ 多带账号字段、空会话编号、处置结果写 cleared 在桥上就拒，一次都不 invoke', async () => {
    const invoke = vi.fn<ProjectCollabInvoke>(async () => ({ ok: true }));
    const api = createProjectCollabPreloadApi(invoke, () => () => undefined);

    await expect(
      api.listProjectPlanningDrafts({ sessionId: SESSION_ID, accountKey: 'a' } as never),
    ).rejects.toThrow();
    await expect(api.listProjectPlanningDrafts({ sessionId: '' })).rejects.toThrow();
    await expect(
      api.discardProjectPlanningDraft({
        sessionId: SESSION_ID,
        draftId: DRAFT_ID,
        outcome: 'cleared',
      } as never),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('⛔ Main 回来的草案形状不对（名称越界、多带字段）在桥上拒收', async () => {
    const api = createProjectCollabPreloadApi(
      vi.fn<ProjectCollabInvoke>(async () => ({
        ok: true,
        drafts: [{ ...DRAFT, name: 'x'.repeat(201) }],
      })),
      () => () => undefined,
    );
    await expect(api.listProjectPlanningDrafts({ sessionId: SESSION_ID })).rejects.toThrow();

    const extra = createProjectCollabPreloadApi(
      vi.fn<ProjectCollabInvoke>(async () => ({
        ok: true,
        drafts: [{ ...DRAFT, prompt: '原话' }],
      })),
      () => () => undefined,
    );
    await expect(extra.listProjectPlanningDrafts({ sessionId: SESSION_ID })).rejects.toThrow();
  });
});

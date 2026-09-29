import { describe, expect, it, vi } from 'vitest';

import { IPC } from '../../../stratex/shared/ipc/channels.js';
import { createProjectWorkspacePreloadApi } from '../../../stratex/preload/projectWorkspaceApi.js';

const collabProjectId = '11111111-1111-4111-8111-111111111111';
const safeResult = {
  ok: true as const,
  snapshot: {
    status: 'bound' as const,
    collabProjectId,
    localProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    displayName: 'Alpha',
    binding: {
      bindingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      revision: 7,
    },
  },
};

describe('project workspace preload API', () => {
  it('keeps directory operations on fixed channels and rejects path injection', async () => {
    const refId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const result = {
      ok: true,
      directories: [
        { refId, displayName: 'References', access: 'read', availability: 'available' },
      ],
    };
    const invoke = vi.fn(async () => result);
    const api = createProjectWorkspacePreloadApi(invoke);
    await expect(api.listProjectLinkedDirectories({ collabProjectId })).resolves.toEqual(result);
    await expect(api.addProjectLinkedDirectory({ collabProjectId })).resolves.toEqual(result);
    await expect(api.removeProjectLinkedDirectory({ collabProjectId, refId })).resolves.toEqual(
      result,
    );
    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_LINKED_DIRECTORY_LIST, { collabProjectId }],
      [IPC.PROJECT_LINKED_DIRECTORY_ADD, { collabProjectId }],
      [IPC.PROJECT_LINKED_DIRECTORY_REMOVE, { collabProjectId, refId }],
    ]);
    await expect(
      api.addProjectLinkedDirectory({ collabProjectId, path: 'C:\\private' } as never),
    ).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(3);
    invoke.mockResolvedValueOnce({
      ...result,
      directories: [{ ...result.directories[0], canonicalPath: 'C:\\private' }],
    } as never);
    await expect(api.listProjectLinkedDirectories({ collabProjectId })).rejects.toThrow();
  });

  it('uses only fixed channels and safe requests', async () => {
    const invoke = vi.fn(async () => safeResult);
    const api = createProjectWorkspacePreloadApi(invoke);

    await expect(api.resolveProjectWorkspace({ collabProjectId })).resolves.toEqual(safeResult);
    await expect(api.selectProjectWorkspace({ collabProjectId })).resolves.toEqual(safeResult);
    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_WORKSPACE_RESOLVE, { collabProjectId }],
      [IPC.PROJECT_WORKSPACE_SELECT, { collabProjectId }],
    ]);
  });

  it('exposes select-local on its own channel with a strict request (A3 控件对等)', async () => {
    const localProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const invoke = vi.fn(async () => safeResult);
    const api = createProjectWorkspacePreloadApi(invoke);

    await expect(
      api.selectProjectLocalWorkspace({ collabProjectId, localProjectId }),
    ).resolves.toEqual(safeResult);
    expect(invoke.mock.calls).toEqual([
      [IPC.PROJECT_WORKSPACE_SELECT_LOCAL, { collabProjectId, localProjectId }],
    ]);
    // strict：多余字段（夹带路径）与缺 localProjectId 都在过 invoke 前被拦。
    await expect(
      api.selectProjectLocalWorkspace({ collabProjectId, localProjectId, path: 'C:\\x' } as never),
    ).rejects.toThrow();
    await expect(api.selectProjectLocalWorkspace({ collabProjectId } as never)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('rejects absolute paths in either direction', async () => {
    const invoke = vi.fn(async () => ({
      ...safeResult,
      snapshot: { ...safeResult.snapshot, canonicalPath: 'C:\\private\\alpha' },
    }));
    const api = createProjectWorkspacePreloadApi(invoke);

    await expect(
      api.resolveProjectWorkspace({ collabProjectId, path: 'C:\\private\\alpha' } as never),
    ).rejects.toThrow();
    await expect(api.resolveProjectWorkspace({ collabProjectId })).rejects.toThrow();
  });
});

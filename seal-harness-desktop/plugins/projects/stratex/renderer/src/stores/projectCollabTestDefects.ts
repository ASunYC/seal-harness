import {
  ProjectTestDefectActionRequestSchema,
  type ProjectTestDefect,
  type ProjectTestDefectActionRequest,
} from '@shared/protocol/project-testing-defects.js';
import type { ProjectCollabState, ProjectDomainHost } from './projectCollabState';
import {
  loadTestingPage,
  newerTestingEntity,
  testingWriteFailure,
  type TestingWriteOutcome,
} from './projectCollabTesting';
import { projectCollabApi } from '../sdk/projectCollab';

export type TestDefectsHost = ProjectDomainHost &
  Pick<ProjectCollabState, 'testDefects' | 'testDefectDetails'>;

export async function loadTestDefects(
  host: TestDefectsHost,
  projectId: string,
  submissionId: string,
  append = false,
): Promise<void> {
  await loadTestingPage(
    host,
    () => host.testDefects[submissionId],
    (page) => {
      host.testDefects = { ...host.testDefects, [submissionId]: page };
    },
    (cursor) => projectCollabApi.testDefects({ projectId, submissionId, cursor, limit: 30 }),
    append,
  );
}

export async function loadTestDefectDetail(
  host: TestDefectsHost,
  projectId: string,
  defectId: string,
  append = false,
): Promise<void> {
  let defect: ProjectTestDefect | null = host.testDefectDetails[defectId]?.defect ?? null;
  await loadTestingPage(
    host,
    () => host.testDefectDetails[defectId],
    (page) => {
      host.testDefectDetails = {
        ...host.testDefectDetails,
        [defectId]: { ...page, defect: page.loaded ? defect : null },
      };
    },
    async (cursor) => {
      const result = await projectCollabApi.testDefectDetail({
        projectId,
        defectId,
        cursor,
        limit: 30,
      });
      if (!result.ok) return result;
      defect = append ? newerTestingEntity(defect, result.defect) : result.defect;
      return { ...result, items: result.history };
    },
    append,
  );
}

export async function performTestDefectAction(
  host: TestDefectsHost,
  request: ProjectTestDefectActionRequest,
): Promise<TestingWriteOutcome> {
  const epoch = host.projectEpoch;
  const parsed = ProjectTestDefectActionRequestSchema.safeParse(request);
  if (!parsed.success) return testingWriteFailure({ code: 'rejected' });
  try {
    const result = await projectCollabApi.testDefectAction(parsed.data);
    if (epoch !== host.projectEpoch) return testingWriteFailure();
    if (!result.ok) return testingWriteFailure(result);
    await Promise.all([
      loadTestDefects(host, request.projectId, result.defect.roundId),
      loadTestDefectDetail(host, request.projectId, result.defect.id),
    ]);
    return epoch === host.projectEpoch ? { ok: true } : testingWriteFailure();
  } catch {
    return testingWriteFailure(epoch === host.projectEpoch ? { code: 'transient' } : undefined);
  }
}

export function selectPendingInteraction(approvals, questions, sessionId, running) {
  if (!sessionId) return undefined;
  return [
    ...approvals.filter((approval) => approval.sessionId === sessionId || (approval.sessionId === undefined && running)).map((value) => ({ kind: "approval", value })),
    ...questions.filter((question) => question.sessionId === sessionId).map((value) => ({ kind: "question", value })),
  ].sort((left, right) => String(left.value.createdAt).localeCompare(String(right.value.createdAt)))[0];
}

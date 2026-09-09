export interface MutationGate { tryLock(): boolean; unlock(): void; pending(): boolean }
export function createMutationGate(onChange?: (pending: boolean) => void): MutationGate;

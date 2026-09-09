export function createMutationGate(onChange = () => {}) {
  let pending = false;
  return {
    tryLock() {
      if (pending) return false;
      pending = true; onChange(true); return true;
    },
    unlock() {
      if (!pending) return;
      pending = false; onChange(false);
    },
    pending() { return pending; },
  };
}

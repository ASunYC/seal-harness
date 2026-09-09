/** Gate one copy control across its write and short success window. */
export function createCopyAction({ write, copied, reset, failed, duration = 1000, schedule = setTimeout, cancel = clearTimeout }) {
  let pending = false;
  let timer = null;
  let disposed = false;
  return Object.freeze({
    state() { return disposed ? "disposed" : timer !== null ? "copied" : pending ? "pending" : "idle"; },
    async activate(value) {
      if (disposed || pending || timer !== null) return false;
      pending = true;
      try { await write(value); }
      catch (error) { pending = false; if (!disposed) failed(error); return false; }
      pending = false;
      if (disposed) return false;
      copied();
      timer = schedule(() => { timer = null; if (!disposed) reset(); }, duration);
      return true;
    },
    dispose() {
      disposed = true;
      pending = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  });
}

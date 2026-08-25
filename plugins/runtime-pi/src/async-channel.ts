export class AsyncChannel<T> implements AsyncIterable<T> {
  readonly #queue: T[] = [];
  readonly #waiting: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) return;
    const waiter = this.#waiting.shift();
    if (waiter === undefined) this.#queue.push(value);
    else waiter({ value, done: false });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiting.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const queued = this.#queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.#closed) return;

      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.#waiting.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }
}

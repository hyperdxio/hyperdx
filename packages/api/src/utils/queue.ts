export class LimitedSizeQueue<T = any> {
  private readonly _limit: number;

  private readonly _queue: T[];

  constructor(limit: number) {
    this._limit = limit;
    this._queue = [];
  }

  enqueue(item: T) {
    this._queue.push(item);
    if (this._queue.length === this._limit + 1) {
      // randomly remove an item
      this._queue.splice(Math.floor(Math.random() * this._limit), 1);
    }
  }

  toArray() {
    return this._queue;
  }
}

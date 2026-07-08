export class TaskQueue {
  private concurrency: number;
  private running: number = 0;
  private queue: (() => Promise<void>)[] = [];

  constructor(options: { concurrency: number }) {
    this.concurrency = options.concurrency;
  }

  add(task: () => Promise<any>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      this.next();
    });
  }

  private next() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }
    const task = this.queue.shift();
    if (task) {
      this.running++;
      task().finally(() => {
        this.running--;
        this.next();
      });
      this.next(); // Try to start more tasks if concurrency allows
    }
  }

  async onIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) {
      return;
    }
    return new Promise((resolve) => {
      const check = () => {
        if (this.running === 0 && this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }
}

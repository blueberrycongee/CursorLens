export type AnalysisJobState = 'pending' | 'running' | 'completed' | 'failed';

export interface AnalysisJobStatus {
  id: string;
  status: AnalysisJobState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export class AnalysisJobQueue<TInput, TResult> {
  private queue: Promise<void> = Promise.resolve();
  private counter = 0;
  private statuses = new Map<string, AnalysisJobStatus>();
  private results = new Map<string, TResult>();

  enqueue(input: TInput, runner: (input: TInput) => Promise<TResult>): Promise<TResult> {
    return this.enqueueWithId(input, runner).promise;
  }

  enqueueWithId(
    input: TInput,
    runner: (input: TInput) => Promise<TResult>,
  ): { id: string; promise: Promise<TResult> } {
    const id = `job-${++this.counter}`;
    const createdAt = Date.now();

    this.statuses.set(id, {
      id,
      status: 'pending',
      createdAt,
    });

    let resolvePromise: (value: TResult) => void;
    let rejectPromise: (reason?: unknown) => void;

    const resultPromise = new Promise<TResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this.queue = this.queue
      .catch(() => {
        // Keep queue chain alive after previous failures.
      })
      .then(async () => {
        this.statuses.set(id, {
          ...this.statuses.get(id)!,
          status: 'running',
          startedAt: Date.now(),
        });

        try {
          const result = await runner(input);
          this.results.set(id, result);
          this.statuses.set(id, {
            ...this.statuses.get(id)!,
            status: 'completed',
            finishedAt: Date.now(),
          });
          resolvePromise(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.statuses.set(id, {
            ...this.statuses.get(id)!,
            status: 'failed',
            finishedAt: Date.now(),
            error: message,
          });
          rejectPromise(error);
        }
      });

    return {
      id,
      promise: resultPromise,
    };
  }

  getStatus(id: string): AnalysisJobStatus | undefined {
    return this.statuses.get(id);
  }

  getResult(id: string): TResult | undefined {
    return this.results.get(id);
  }

  listStatuses(): AnalysisJobStatus[] {
    return Array.from(this.statuses.values());
  }
}

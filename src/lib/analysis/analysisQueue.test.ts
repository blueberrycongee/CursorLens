import { describe, expect, it } from 'vitest';
import { AnalysisJobQueue } from './analysisQueue';

describe('AnalysisJobQueue', () => {
  it('runs jobs sequentially and stores completion results', async () => {
    const queue = new AnalysisJobQueue<number, number>();
    const order: number[] = [];

    const first = queue.enqueue(1, async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(input);
      return input + 1;
    });

    const second = queue.enqueue(2, async (input) => {
      order.push(input);
      return input + 1;
    });

    await Promise.all([first, second]);

    expect(order).toEqual([1, 2]);
    expect(queue.getStatus('job-1')?.status).toBe('completed');
    expect(queue.getStatus('job-2')?.status).toBe('completed');
    expect(queue.getResult('job-1')).toBe(2);
    expect(queue.getResult('job-2')).toBe(3);
  });

  it('marks failed jobs and keeps queue alive', async () => {
    const queue = new AnalysisJobQueue<number, number>();

    await expect(
      queue.enqueue(1, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const status = queue.getStatus('job-1');
    expect(status?.status).toBe('failed');

    const result = await queue.enqueue(2, async (input) => input * 2);
    expect(result).toBe(4);
    expect(queue.getStatus('job-2')?.status).toBe('completed');
  });
});

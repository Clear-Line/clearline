/**
 * Scheduler — defines cron schedules for all pipeline jobs.
 * Uses node-cron for in-process scheduling (no external cron service needed).
 */

import cron from 'node-cron';

type JobFn = () => Promise<void>;

interface ScheduledJob {
  name: string;
  schedule: string;  // cron expression
  fn: JobFn;
  running: boolean;
}

const jobs: ScheduledJob[] = [];

/**
 * Register a job with the scheduler.
 * Jobs are guarded against overlapping execution.
 */
export function registerJob(name: string, schedule: string, fn: JobFn): void {
  jobs.push({ name, schedule, fn, running: false });
}

/**
 * Start all registered jobs.
 */
export function startScheduler(): void {
  console.log(`[Scheduler] Starting ${jobs.length} jobs...`);

  for (const job of jobs) {
    cron.schedule(job.schedule, async () => {
      if (job.running) {
        console.log(`[Scheduler] Skipping ${job.name} — still running from previous cycle`);
        return;
      }

      job.running = true;
      const start = Date.now();
      console.log(`[Scheduler] Starting ${job.name}...`);

      try {
        await job.fn();
        console.log(`[Scheduler] ${job.name} completed in ${Date.now() - start}ms`);
      } catch (err) {
        console.error(`[Scheduler] ${job.name} failed after ${Date.now() - start}ms:`, err);
      } finally {
        job.running = false;
      }
    });

    console.log(`[Scheduler] Registered: ${job.name} @ ${job.schedule}`);
  }
}

import type { Db } from "../db/client.ts";
import type { Mailer } from "../mail/mailer.ts";
import { jobs } from "./registry.ts";

/** What a job may use. */
export interface JobDeps {
  db: Db;
  mailer: Mailer;
}

/** A background job: `run` does one round of its work and returns; the runner calls it again later. */
export interface Job {
  name: string;
  run(deps: JobDeps): Promise<void>;
}

/**
 * One round of every registered job, one after another. A job that throws does not stop the others. In production
 * every instance of the API runs this every few seconds, so two rounds of the same job may run at the same moment.
 */
export async function runJobsOnce(deps: JobDeps): Promise<void> {
  for (const job of jobs) {
    try {
      await job.run(deps);
    } catch (err) {
      console.error(`[job ${job.name}] failed`, err);
    }
  }
}

/** Runs `runJobsOnce` every `everyMs` (the server); the returned function stops it. */
export function startJobs(deps: JobDeps, everyMs = 5_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runJobsOnce(deps).finally(() => {
      running = false;
    });
  }, everyMs);
  return () => clearInterval(timer);
}

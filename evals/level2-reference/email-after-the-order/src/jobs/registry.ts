import type { Job } from "./runner.ts";
import { sendOutbox } from "./send-outbox.ts";

/** Every background job of the API: add a job here and the runner (`runJobsOnce`, `startJobs`) runs it. */
export const jobs: Job[] = [sendOutbox];

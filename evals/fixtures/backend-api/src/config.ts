import { z } from "zod";

/** The one place environment variables are read; every name is listed in .env.example. */
const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_DIR: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  MAIL_FROM: z.string().email().default("no-reply@tracker.example"),
  PAYMENTS_URL: z.string().url().default("https://payments.example"),
  PAYMENTS_API_KEY: z.string().default(""),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) throw new Error(`invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return { ...parsed.data, DATABASE_DIR: parsed.data.DATABASE_DIR || undefined };
}

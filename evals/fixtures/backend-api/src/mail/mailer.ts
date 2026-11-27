/**
 * The adapter to the mail provider. Code sends mail only through this interface; tests replace it with
 * `memoryMailer`, and no test talks to a real provider.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * `timeoutMs`: how long the provider may take; left out, its HTTP client waits as long as the connection stays open.
 * `idempotencyKey`: the provider sends a mail once per key, so sending again with the same key after a lost answer
 * does not send it twice.
 */
export interface SendOptions {
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface Mailer {
  send(mail: Mail, opts?: SendOptions): Promise<void>;
}

/**
 * A fake provider. `calls` keeps every call, `sent` every mail the provider sent (one per idempotency key, as the real
 * one does). `failWith` makes the next calls throw before anything is sent (the provider is down); `failAfterSend`
 * makes them throw after the mail was sent (the answer was lost, as on a timeout).
 */
export function memoryMailer(): Mailer & {
  sent: Mail[];
  calls: { mail: Mail; opts?: SendOptions }[];
  failWith: Error | null;
  failAfterSend: Error | null;
} {
  const keys = new Set<string>();
  const m = {
    sent: [] as Mail[],
    calls: [] as { mail: Mail; opts?: SendOptions }[],
    failWith: null as Error | null,
    failAfterSend: null as Error | null,
    async send(mail: Mail, opts?: SendOptions) {
      m.calls.push({ mail, ...(opts ? { opts } : {}) });
      if (m.failWith) throw m.failWith;
      const key = opts?.idempotencyKey;
      if (!key || !keys.has(key)) {
        if (key) keys.add(key);
        m.sent.push(mail);
      }
      if (m.failAfterSend) throw m.failAfterSend;
    },
  };
  return m;
}

/** Local development: prints the mail instead of sending it. */
export function consoleMailer(from: string): Mailer {
  return {
    async send(mail) {
      console.log(`[mail from ${from} to ${mail.to}] ${mail.subject}`);
    },
  };
}

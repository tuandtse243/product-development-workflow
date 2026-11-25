/**
 * The adapter to the mail provider. Code sends mail only through this interface; tests replace it with
 * `memoryMailer`, and no test talks to a real provider.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Keeps every mail in `sent`; `failWith` makes the next sends throw (to test a failing provider). */
export function memoryMailer(): Mailer & { sent: Mail[]; failWith: Error | null } {
  const m = {
    sent: [] as Mail[],
    failWith: null as Error | null,
    async send(mail: Mail) {
      if (m.failWith) throw m.failWith;
      m.sent.push(mail);
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

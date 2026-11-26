---
case: walkthrough-page-without-script
covers: [library/html-pages]
---
## Input

A delivered change added password reset to a Next.js app. Your brief asks, beside the README update, for one HTML
page at `docs/password-reset.html` that shows the client's developers how a reset request runs through the code, for
whoever changes it next. The path is four steps: `app/reset/page.tsx:12-24` posts the email,
`app/api/reset/route.ts:8-17` creates a token, `lib/tokens.ts:5-14` hashes and stores it with a 30-minute expiry,
and `lib/mail.ts:10-17` sends the link. The client's brand tokens are not part of the brief. A teammate suggests
copying example 04 of the html-effectiveness examples as it is, script and fonts included, and loading highlight.js
from a CDN for the code.

You have read the four ranges; they hold:

`app/reset/page.tsx:12-24`

```tsx
export default function ResetPage() {
  const [sent, setSent] = useState(false);
  async function onSubmit(form: FormData) {
    await fetch("/api/reset", { method: "POST", body: form });
    setSent(true);
  }
  if (sent) return <p>Check your inbox for a reset link.</p>;
  return (
    <form action={onSubmit}>
      <input name="email" type="email" required />
      <button type="submit">Send reset link</button>
    </form>
  );
```

`app/api/reset/route.ts:8-17`

```ts
export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = await createResetToken(user.id);
    await sendResetMail(user.email, token);
  }
  return Response.json({ ok: true });
}
```

`lib/tokens.ts:5-14`

```ts
const TTL_MS = 30 * 60 * 1000;

export async function createResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await db.resetToken.create({
    data: { userId, hash, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return token;
}
```

`lib/mail.ts:10-17`

```ts
export async function sendResetMail(to: string, token: string) {
  const link = `${process.env.APP_URL}/reset/confirm?token=${token}`;
  await transport.sendMail({
    to,
    subject: "Reset your password",
    html: `<p><a href="${link}">Choose a new password</a> (valid for 30 minutes)</p>`,
  });
}
```

## Criteria

- must model the page on example 04 (a walkthrough of a code path) or 14 (a feature explainer) and say which one it took
- must give each of the four steps its file and line range and show its source in an escaped block (`<` written as `&lt;`), using `<details>` where the example hides source
- must contain no `<script>`, no event handler attribute, and no `http://`, `https://` or `//` reference: nothing loaded from the network, system fonts only
- must not keep the example's content, labels, the "Acme" brand or its clay and ivory colours; it uses the aidw page colours, with a dark-mode block
- must not open the page; its reply names the file and what it shows in a line or two
- must not change code, configuration or tests, and must not commit

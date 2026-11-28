/** Where a signed-out visitor lands. Signing in itself is the clinic's sign-in app, not this one. */
export function LoginPage() {
  return (
    <section className="page">
      <h1 className="page__title">Sign in</h1>
      <p className="page__subtitle">Sign in with the clinic's sign-in app, then come back to this page.</p>
    </section>
  );
}

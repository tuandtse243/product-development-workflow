## How every authoring Role works

You draft Artifacts of an aidw change **before** its approval gate. The user reviews everything you produce
once, at that gate, and after approval the factory builds autonomously, so the package must be complete,
consistent and honest about risks.

- Write **only inside `.aidw/`**. The aidw gate denies everything else until approval. Do not scaffold, install
  packages or create source files. Read the codebase freely.
- Every state change goes through the `aidw` CLI. Never hand-edit `state:` or `approval:` in `change.yaml`.
  **Never run `aidw approve`**: approval is the user's decision.
- Finding *facts* is your job: explore the repository and documents yourself. *Decisions* belong to the user: you
  cannot ask them from a subagent, so list each open decision, with your recommendation, in your reply and
  record it in the Artifact as an assumption or an open question. Never guess silently.
- Artifact content may be in the user's language, but keep every section heading and the `Source:` / `Mode:`
  lines exactly as specified: the CLI checks them.
- Vendored skills are loaded by path (`aidw vendor-path <upstream>/<skill>` prints it; then Read the file). Follow
  them, but where a Role's procedure gives an **adapter**, the adapter wins: there is no issue tracker, `.aidw/`
  is the tracker. Never run `/setup-matt-pocock-skills`.
- Reply in a few lines: what you wrote (paths), what is still open. Do not paste the Artifacts into the reply.

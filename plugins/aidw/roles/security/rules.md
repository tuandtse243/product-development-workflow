- You are read-only except for one file: your verdict file (the brief names its path; the Write tool is only
  for that). Do not edit files or run commands that change the project; the aidw gate denies them.
- Do not fix problems yourself: describe them so a fix task can.
- Use `fix` only for blocking issues: something exploitable, data exposed to the wrong user, a secret in the
  client or the repository, a high or critical dependency finding the Analysis did not accept. Hardening wishes
  are non-blocking; say them under `Non-blocking:` so they reach the handoff.

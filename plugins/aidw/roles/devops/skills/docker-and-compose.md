---
name: docker-and-compose
description: Dockerfile, compose and .dockerignore for an app and the services it needs.
---

# Docker and compose

- **Multi-stage.** One stage installs and builds, the last stage copies only what runs. Use a slim base pinned to a major
  version (`node:22-slim`, not `latest`).
- **Reproducible install.** Copy the lockfile and manifest first, install with the frozen-lockfile flag of the package manager,
  then copy the sources, so the dependency layer is cached.
- **Non-root.** End with a `USER` that is not root. A port above 1024.
- **`.dockerignore`.** At least `node_modules`, `.git`, `.env*` (but not `.env.example`), build output and `.aidw`. A `.env` copied
  into an image is a leaked secret.
- **Configuration from the environment.** `ENV` carries defaults that are not secret (`NODE_ENV`, `PORT`). A secret is never an
  `ENV` or `ARG` line: it is passed at run time.
- **Compose for local development.** Name each service, give the database a named volume and a `healthcheck`, and make the app
  `depends_on` it with `condition: service_healthy`. Values come from `${VAR}` or an `env_file` that is git-ignored; the
  repository holds `.env.example` with names and harmless placeholders.
- **Check.** `hadolint --failure-threshold warning Dockerfile` when hadolint is installed (or
  `docker run --rm -i hadolint/hadolint < Dockerfile`); `docker compose config` must succeed; `docker build .` when Docker
  is available.

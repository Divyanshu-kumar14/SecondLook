# syntax=docker/dockerfile:1

# ── Why Debian, not Alpine ────────────────────────────────────────────────
# Deliberately. D14 documents that the client build pulls two prebuilt platform
# binaries (Vite's bundler and CSS minifier). Those are glibc builds; on Alpine's
# musl libc they fail to load and the build dies with a linker error. Debian/slim
# is the honest choice — it matches the host the demo was actually verified on.
# Switching to Alpine would require source builds and a toolchain, which is
# exactly the portability risk DoD #1 exists to rule out.

# ── Stage 1: build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer.
# --ignore-scripts because `prepare` runs `npm run build` — and at this point in
# the layer there is no source yet, so the build would fail on a clean checkout.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY scripts ./scripts
COPY fixtures ./fixtures

RUN npm run build


# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force

# Build artefacts from stage 1.
COPY --from=builder /app/dist ./dist

# `fixtures/` is a RUNTIME dependency, not test data: server/index.ts imports
# ../fixtures/seed.js to seed the demo log on every boot. Dropping this directory
# is what makes "no environment variables" false — the server would boot with an
# empty log and every rule would return NONE_FOUND_IN_RECORD for the wrong reason.
COPY fixtures ./fixtures

# The log is written to .data/ at runtime, so the app tree must be writable by
# the unprivileged user we drop to below.
RUN mkdir -p /app/.data && chown -R node:node /app

USER node

EXPOSE 8787

# Judges get a hard green/red on `docker run` without having to curl anything.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No environment variables. Every process.env read in server/ has a default
# (`?? 'demo'`, `?? '.data/events.jsonl'`, ...), which is what lets DoD #1 hold.
CMD ["npm", "start"]
# Diff review web replacement design

Date: 2026-05-18

## Goal

Replace the upstream `pi-diff-review` package with a local Pi extension that launches a browser-based, session-scoped diff review experience for the current repo.

## Requirements

### Core user workflow

- User runs `/diff-review` from Pi.
- Pi starts or reuses a review session for the current Pi session and current repo root.
- Pi prints a local URL that opens in the browser.
- The browser shows the repo tree, changed file highlighting, and a full-file diff viewer.
- The user adds file-level or line/range comments.
- The user submits all open review comments as one synthesized request to Pi.
- Pi replies inline in the review UI through a structured bridge.
- The review stays open for additional comments and repeated submit cycles.

### Scope constraints

- Session-scoped, ephemeral review state only for v1.
- Reuse the review session only within the same Pi session and same repo root.
- Primary diff scope is working tree vs `HEAD`.
- Secondary diff scope may include merge-base vs `HEAD` if it fits the same abstraction cleanly.
- Comments may be placed on any line, not only changed lines.
- One-level threads are sufficient.
- Pi replies are plain text only in v1.

## Chosen approach

Build a thin local Pi extension that owns review session state, runs a local HTTP server, serves a small React app, and exposes a structured tool that Pi uses to write replies back into the active review.

## Why this approach

This keeps Pi-specific orchestration in the extension while letting the browser own the visual review experience. It matches the desired local and ephemeral workflow, avoids native window dependencies, supports inline replies cleanly, and preserves clear boundaries for future persistence or additional diff scopes.

## Architecture

### Main units

1. **Pi command extension**
   - Registers `/diff-review`.
   - Resolves the current Pi session key and repo root.
   - Reuses or creates a review session for that `(piSessionKey, repoRoot)` pair.
   - Starts the local server if needed.
   - Prints the review URL.

2. **Review session store**
   - Keeps in-memory state for the active review.
   - Keys review sessions by `(piSessionKey, repoRoot)`.
   - Tracks selected file, diff mode, comments, submissions, and live connections.
   - Owns cleanup on session shutdown.

3. **Diff provider layer**
   - Resolves repo tree contents and changed file metadata.
   - Produces old/new/current file snapshots for the viewer.
   - Hides the specifics of working-tree and merge-base diff modes behind one interface.

4. **Local review server**
   - Serves static frontend assets.
   - Exposes JSON API routes for bootstrap, tree data, file data, comments, and submission.
   - Exposes a live update stream for browser refreshes when Pi replies arrive.

5. **Frontend review app**
   - Renders a three-panel layout: repo tree, diff viewer, comment panel.
   - Uses `@pierre/trees` for navigation and `@pierre/diffs` for file rendering.
   - Lets the user create file-level and line/range comments.
   - Shows Pi replies inline and in the thread panel.

6. **Structured Pi reply tool**
   - Accepts a target review session, thread/comment id, and plain-text reply.
   - Updates session state and pushes the change to connected browsers.

## File layout

```text
pi-extension/
  diff-review/
    index.ts
    server.ts
    state.ts
    types.ts
    git.ts
    prompt.ts
    reply-tool.ts
    cleanup.ts
    static/
    web/
      index.html
      vite.config.ts
      src/
        main.tsx
        App.tsx
        api.ts
        types.ts
        state/
          review-session.ts
        components/
          ReviewLayout.tsx
          RepoTreePanel.tsx
          FilterBar.tsx
          DiffToolbar.tsx
          DiffViewer.tsx
          CommentComposer.tsx
          CommentThread.tsx
          CommentSidebar.tsx
          EmptyState.tsx
        adapters/
          pierre-diffs.tsx
          pierre-trees.tsx

test/
  extensions/
    diff-review.test.mjs
```

## Runtime behavior

### `/diff-review`

When `/diff-review` runs:

1. Determine the current Pi session identity.
2. Determine the repo root from the current working directory.
3. Look up an existing review session for that `(piSessionKey, repoRoot)` pair.
4. If found, reuse the session and print its URL.
5. If not found, create a new review session, start a server, and print the new URL.

If the user changes repositories within the same Pi session, `/diff-review` must open a different review session for the new repo root rather than reusing the old one.

### Session lifecycle

- Review sessions live only in memory.
- Each Pi session may have multiple review sessions only when they correspond to different repo roots.
- The uniqueness key for reuse is `(piSessionKey, repoRoot)`.
- A new Pi session always gets new review sessions.
- On Pi session shutdown, the extension disposes all review sessions and servers associated with that Pi session.
- Stale browser tabs remain open but receive a clear "session closed" or reconnect error state.

## Data model

### Review session

Track at least:

- `reviewSessionId`
- `piSessionKey`
- `repoRoot`
- `sessionKey` (derived `(piSessionKey, repoRoot)` identifier)
- `serverUrl`
- `serverSecret`
- `diffMode`
- `selectedPath`
- `treeFilter`
- `comments`
- `threads`
- `pendingSubmission`
- `submissionHistory`
- `nextSubmissionRound`
- `createdAt`
- `updatedAt`

### Comment anchors

A comment anchor must support both changed-line comments and comments on unchanged lines.

Required fields:

- `path`
- `targetSide` (`old`, `new`, or `current`)
- `startLine`
- `endLine`
- optional diff metadata when the anchor corresponds to a diff hunk

This keeps v1 simple while leaving room for richer reconciliation later.

### Threads

Each thread contains:

- one root user comment
- zero or more Pi replies, but replies are stored as a flat per-round list rather than nested conversation

For v1, users do not reply inline to Pi replies inside the same thread. If the user wants follow-up after Pi has already replied, they create a new root comment. This preserves one-level threads while still allowing repeated submit cycles without overwriting prior Pi responses.

## Diff provider model

Expose a common interface that can answer:

- what files exist in the repo tree
- which files are changed in the selected diff mode
- what old/new/current contents should be shown for a path
- what file status applies to that path (`modified`, `added`, `deleted`, `renamed`, `binary`)

### v1 modes

1. **Working tree vs `HEAD`**
   - Default and required.
   - Covers uncommitted local changes.

2. **Merge-base vs `HEAD`**
   - Optional in v1.
   - Must use the same provider interface.
   - If merge-base resolution fails, the UI should surface the failure and fall back cleanly.

## Browser API

### Server binding and request security

- Bind the review server to loopback only (`127.0.0.1` or `localhost`).
- Generate a per-review `serverSecret` when the session is created.
- Include that secret in the initial review URL and require it on every JSON API and SSE request.
- Reject requests with a missing or invalid secret.
- Keep CORS disabled by default and do not expose cross-origin access.
- Treat the review URL as capability-bearing local access for that review session only.

### Static assets

- Serve a built frontend bundle from `pi-extension/diff-review/static/`.
- Do not require Vite in the runtime extension path.
- `web/` is the source tree and `static/` is generated build output.
- Add an explicit package script to build `web/` into `static/` before release or manual testing.
- For v1, commit the built `static/` assets so the extension works without a frontend build step at Pi runtime.
- Add verification so implementation changes fail fast if `web/` source and committed `static/` assets drift.

### JSON endpoints

At minimum:

- `GET /api/session` — bootstrap review state
- `GET /api/tree` — repo tree and changed-file metadata
- `GET /api/file?path=...` — full file/diff payload for selected path
- `POST /api/diff-mode` — switch active diff mode
- `POST /api/comments` — create a comment
- `PATCH /api/comments/:id` — update a comment draft or text if editing is allowed
- `DELETE /api/comments/:id` — delete a comment if allowed
- `POST /api/submit` — synthesize and submit the current review to Pi for a new submission round

### Live updates

Use either SSE or websocket for:

- Pi reply arrival
- submission state changes
- session closure notifications

SSE is preferred for v1 unless a websocket becomes necessary for package integration. The same per-review secret used by the JSON API must be validated for the live update connection.

## Frontend behavior

### Layout

Use a three-panel layout:

- **Left:** whole repo tree with changed-file highlighting and filtering
- **Center:** full-file diff view with changes highlighted, ideally in split view
- **Right:** thread list and active comment details

### Tree behavior

- Show the full repo tree, not only changed files.
- Visually mark changed files.
- Support changed-only filtering.
- Support text search/filtering.
- Preserve selected file state while filters change.

### Diff viewer behavior

- Render changed files with highlighted hunks.
- Render unchanged files as current-file view when selected.
- Allow file-level comments.
- Allow single-line comments from a simple line click/cursor target.
- Allow range comments from multi-line selection.
- Show existing comments inline and in the thread panel.

### Comment behavior

- Support any-line anchors, not only changed lines.
- Keep root comments distinct from Pi replies.
- Support one-level threads only.
- Keep submission open across multiple review rounds.
- Once a thread has at least one Pi reply, further user follow-up should be captured as a new root thread rather than as a nested reply.

## Pi submission and reply flow

### Submission contract

Submitting a review should generate one synthesized prompt containing:

- review session id
- submission round id
- diff mode
- file references
- line references
- file-level comments
- line/range comments
- stable comment ids
- explicit reply-tool instructions

The prompt must explicitly instruct Pi to answer by calling the structured reply tool rather than by only producing freeform chat text.

### Submission lifecycle

For v1, `POST /api/submit` follows this exact lifecycle:

1. Validate the review session secret and ensure the session is active.
2. Reject the request if another submission round is already pending for that review session.
3. Check whether the hosting Pi session is already busy or otherwise unable to accept a new injected review request.
4. Snapshot all currently open root comments into a new `submissionRoundId` and prepare the synthesized prompt payload in memory.
5. Attempt to inject one synthesized user message into Pi using the session messaging mechanism chosen during implementation.
6. Only after message injection successfully starts a Pi turn may the extension persist the new pending submission record and mark those comments as submitted in that round.
7. While Pi is responding, the browser shows the review as `pending`.
8. Pi responds by calling the structured reply tool one or more times, always including `reviewSessionId` and `submissionRoundId`.
9. The extension accepts only reply-tool payloads that match the active review session and a known submission round.
10. When Pi finishes or the round is explicitly closed, mark the submission record complete and clear the pending state.

If the chosen Pi injection mechanism fails before a Pi turn is successfully started, the submit attempt must be atomic from the review session's perspective: do not leave a persisted `pendingSubmission`, do not mark comments as submitted, and keep those comments eligible for the next submit attempt. If implementation constraints require creating temporary pending state before the injection call returns, the failure path must roll back completely before the API response is sent.

For v1, allow only one pending submission round per review session at a time. If Pi is already busy with a review submission, later submit requests should be rejected with a clear UI message rather than queued.

### Busy-session behavior

- If the hosting Pi session is already streaming another response, the extension must fail the submit request clearly before mutating review state instead of trying to interleave review traffic.
- The browser should surface this as a recoverable "Pi is busy" state and let the user submit again later.
- If transport or injection setup fails after the browser initiated submit, the API must return an error and the review must remain in a non-pending state with its comments still open.
- The implementation must choose one explicit injection mechanism and test it, rather than leaving submission delivery implicit.

### Reply tool contract

The reply tool should accept:

- `reviewSessionId`
- `submissionRoundId`
- `threadId` or `commentId`
- `path`
- optional line reference
- plain-text reply

The extension validates the payload, stores the reply on the target thread as a reply record for that submission round, and pushes it to connected browsers.

## Error handling

Handle these cases explicitly:

- missing git repo
- missing `HEAD`
- merge-base failure
- binary or unreadable files
- deleted files
- renamed files
- server port conflicts
- malformed reply-tool payloads
- stale or expired review sessions

Errors should be visible in both Pi output and browser UI when relevant.

## Package cutover

The v1 implementation must replace the currently active upstream package wiring in this repo.

Required manifest work:

- update `package.json` to load `./pi-extension/diff-review/index.ts`
- remove `./node_modules/pi-diff-review/src/index.ts` from the Pi extensions list
- remove the `pi-diff-review` dependency if no longer needed after the cutover
- add the new browser/runtime/build dependencies required by the local implementation
- add package scripts for building the frontend bundle into `pi-extension/diff-review/static/`

The replacement is not complete until the repo manifest points Pi at the local extension instead of the upstream one.

## Testing strategy

### Backend/extension tests

Add tests for:

- session reuse keyed by `(piSessionKey, repoRoot)`
- session cleanup on shutdown
- diff provider behavior for working tree mode
- merge-base mode failure handling
- comment anchor serialization
- prompt synthesis
- reply-tool validation and state updates, including `submissionRoundId` validation
- server bootstrap and core API routes
- loopback binding and secret validation on JSON/SSE routes
- manifest-level regression coverage proving the local extension replaced the upstream package entry

### Frontend smoke coverage

If practical, add at least one smoke test covering:

- bootstrap
- file selection
- comment creation state
- reply rendering state updates

## Dependency plan

### Runtime

- `@earendil-works/pi-coding-agent`
- Node built-ins: `http`, `fs`, `path`, `url`, `child_process`
- existing schema tooling (`@sinclair/typebox` if needed)

### Browser

- `react`
- `react-dom`
- `@pierre/diffs`
- `@pierre/trees`

### Build-time

- `vite`
- `@vitejs/plugin-react`
- `typescript`

### Frontend build contract

- source lives under `pi-extension/diff-review/web/`
- build output lives under `pi-extension/diff-review/static/`
- add npm scripts for build and rebuild verification
- commit generated `static/` output in v1 so runtime does not depend on local build tooling
- include verification that catches stale generated assets

## Expandability rules

Keep these boundaries stable so later work stays local:

- diff-provider abstraction for staged, commit, branch, or PR scopes
- storage abstraction for in-memory now and persistent storage later
- frontend adapter wrappers around Pierre packages
- structured reply schema that can later add resolution, labels, severity, and suggestions
- browser API contracts that can later support persisted or shared review sessions

## Verification

Before calling this complete, verify:

- `/diff-review` resolves or creates the expected review session for the current `(piSessionKey, repoRoot)` pair
- the local URL opens and loads the repo tree
- changed files are highlighted and filterable
- selecting a file loads the correct diff/full-file payload
- file-level and line/range comments can be created
- the server binds only to loopback and rejects requests without the review secret
- a submit action synthesizes one Pi request and marks exactly one pending submission round
- Pi replies arrive through the structured tool, validate `submissionRoundId`, and appear inline
- repeat submissions work within the same review session without overwriting earlier Pi replies
- changing repos within one Pi session creates or reuses the correct repo-specific review session
- a new Pi session gets a different review session
- shutdown cleans up the server and state

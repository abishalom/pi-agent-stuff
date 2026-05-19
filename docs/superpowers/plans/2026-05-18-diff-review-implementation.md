# Diff Review Web Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upstream `pi-diff-review` package with a local `/diff-review` extension that launches a session-scoped browser review UI with inline Pi replies.

**Architecture:** A local Pi extension will own review-session state, diff loading, prompt synthesis, a structured reply tool, and a loopback-only HTTP server. The browser UI will be a small React app built into committed static assets, using `@pierre/diffs` and `@pierre/trees` through thin adapters.

**Tech Stack:** TypeScript, Node `http/fs/path/url/child_process`, `@earendil-works/pi-coding-agent`, `@sinclair/typebox`, React, ReactDOM, Vite, `@pierre/diffs`, `@pierre/trees`, Node test runner.

---

## File map

### New extension files
- `pi-extension/diff-review/index.ts` — registers `/diff-review`, hooks `session_shutdown`, wires server and reply tool
- `pi-extension/diff-review/types.ts` — domain types for sessions, comments, anchors, diff payloads, submission rounds, SSE events
- `pi-extension/diff-review/state.ts` — in-memory review session store keyed by `(piSessionKey, repoRoot)`
- `pi-extension/diff-review/git.ts` — repo tree loading, diff mode abstraction, file content loading
- `pi-extension/diff-review/prompt.ts` — synthesized submit prompt builder
- `pi-extension/diff-review/reply-tool.ts` — `diff_review_reply` tool schema + state updates
- `pi-extension/diff-review/server.ts` — loopback HTTP server, API routes, SSE stream, static serving
- `pi-extension/diff-review/cleanup.ts` — server/session disposal helpers if extraction helps clarity

### New frontend source files
- `pi-extension/diff-review/web/index.html`
- `pi-extension/diff-review/web/vite.config.ts`
- `pi-extension/diff-review/web/src/main.tsx`
- `pi-extension/diff-review/web/src/App.tsx`
- `pi-extension/diff-review/web/src/api.ts`
- `pi-extension/diff-review/web/src/types.ts`
- `pi-extension/diff-review/web/src/state/review-session.ts`
- `pi-extension/diff-review/web/src/components/ReviewLayout.tsx`
- `pi-extension/diff-review/web/src/components/RepoTreePanel.tsx`
- `pi-extension/diff-review/web/src/components/FilterBar.tsx`
- `pi-extension/diff-review/web/src/components/DiffToolbar.tsx`
- `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- `pi-extension/diff-review/web/src/components/CommentComposer.tsx`
- `pi-extension/diff-review/web/src/components/CommentThread.tsx`
- `pi-extension/diff-review/web/src/components/CommentSidebar.tsx`
- `pi-extension/diff-review/web/src/components/EmptyState.tsx`
- `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- `pi-extension/diff-review/web/src/adapters/pierre-trees.tsx`

### Generated frontend output
- `pi-extension/diff-review/static/*` — committed Vite build output served at runtime

### New tests
- `test/extensions/diff-review-manifest.test.mjs` — package cutover and dependency/script coverage
- `test/extensions/diff-review-extension.test.mjs` — command registration, session reuse, busy-submit behavior
- `test/extensions/diff-review-state.test.mjs` — session keying, submission round transitions, completion, and atomic rollback behavior
- `test/extensions/diff-review-git.test.mjs` — diff provider behavior using temp git repos
- `test/extensions/diff-review-prompt.test.mjs` — synthesized prompt structure and reply-tool instructions
- `test/extensions/diff-review-server.test.mjs` — loopback binding, secret validation, comments API, diff-mode fallback, SSE basics
- `test/extensions/diff-review-web-smoke.test.mjs` — frontend state/bootstrap smoke coverage and static-drift verification checks

### Existing files to modify
- `package.json` — remove upstream extension entry/dependency, add local extension entry, add deps/scripts
- `package-lock.json` — dependency lockfile updates
- `README.md` — document `/diff-review` and build/runtime behavior
- `.gitignore` — already updated on branch root to ignore `.worktrees/`; no further plan work needed unless frontend tooling adds generated files to ignore

---

### Task 1: Package cutover and extension skeleton

**Files:**
- Create: `pi-extension/diff-review/index.ts`
- Create: `pi-extension/diff-review/types.ts`
- Test: `test/extensions/diff-review-manifest.test.mjs`
- Test: `test/extensions/diff-review-extension.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write the failing manifest and registration tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import packageJson from "../../package.json" with { type: "json" };
import diffReviewExtension from "../../pi-extension/diff-review/index.ts";

test("package manifest loads local diff-review extension instead of upstream package", () => {
  assert.ok(packageJson.pi.extensions.includes("./pi-extension/diff-review/index.ts"));
  assert.ok(!packageJson.pi.extensions.includes("./node_modules/pi-diff-review/src/index.ts"));
});

test("diff-review extension registers command and reply tool", () => {
  const pi = createFakePi();
  diffReviewExtension(pi);
  assert.ok(pi.commands.has("diff-review"));
  assert.ok(pi.tools.has("diff_review_reply"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: FAIL because the manifest still points at upstream `pi-diff-review` and the local extension does not exist yet.

- [ ] **Step 3: Write the minimal package cutover and extension scaffold**

```ts
// pi-extension/diff-review/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function diffReviewExtension(pi: ExtensionAPI) {
  pi.registerCommand("diff-review", {
    description: "Open a local browser diff review session",
    handler: async () => {
      throw new Error("not implemented yet");
    },
  });

  pi.registerTool({
    name: "diff_review_reply",
    description: "Record a Pi reply for a diff review thread",
    parameters: { type: "object", properties: {} },
    async execute() {
      throw new Error("not implemented yet");
    },
  } as never);
}
```

Also update `package.json` to:
- remove `./node_modules/pi-diff-review/src/index.ts`
- add `./pi-extension/diff-review/index.ts`
- remove `pi-diff-review` dependency
- add runtime/build deps:
  - `@pierre/diffs`
  - `@pierre/trees`
  - `react`
  - `react-dom`
  - `vite`
  - `@vitejs/plugin-react`
  - `typescript`

Add scripts:
- `build:diff-review-web`
- `verify:diff-review-web`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add package.json package-lock.json pi-extension/diff-review/index.ts pi-extension/diff-review/types.ts test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-extension.test.mjs
git commit -m "feat: scaffold local diff review extension"
```

### Task 2: Review session store, prompt synthesis, and reply-tool semantics

**Files:**
- Create: `pi-extension/diff-review/state.ts`
- Create: `pi-extension/diff-review/prompt.ts`
- Create: `pi-extension/diff-review/reply-tool.ts`
- Modify: `pi-extension/diff-review/index.ts`
- Modify: `pi-extension/diff-review/types.ts`
- Test: `test/extensions/diff-review-state.test.mjs`
- Test: `test/extensions/diff-review-prompt.test.mjs`
- Modify: `test/extensions/diff-review-extension.test.mjs`

- [ ] **Step 1: Write the failing state/prompt tests**

```js
test("review sessions are keyed by pi session key and repo root", () => {
  const store = createReviewSessionStore();
  const a = store.create({ piSessionKey: "s1", repoRoot: "/repo-a" });
  const b = store.create({ piSessionKey: "s1", repoRoot: "/repo-b" });
  assert.notEqual(a.reviewSessionId, b.reviewSessionId);
});

test("submit state is atomic when Pi injection fails", async () => {
  const session = makeSessionWithOpenThread();
  await assert.rejects(() => submitReview(session, failingInject));
  assert.equal(session.pendingSubmission, null);
  assert.equal(session.threads[0].root.status, "open");
});

test("completed submission rounds clear pending state and allow later submits", async () => {
  const session = makeSessionWithOpenThread();
  const round = await submitReview(session, successfulInject);
  completeSubmissionRound(session, round.id);
  assert.equal(session.pendingSubmission, null);
  const nextRound = await submitReview(session, successfulInject);
  assert.notEqual(nextRound.id, round.id);
});

test("prompt synthesis includes the full submit contract and requires tool-call replies", () => {
  const prompt = buildReviewPrompt(makeSessionWithFileAndLineComments(), makeSubmissionRound());
  assert.match(prompt, /diff_review_reply/);
  assert.match(prompt, /reviewSessionId/);
  assert.match(prompt, /submissionRoundId/);
  assert.match(prompt, /working-tree-vs-head/);
  assert.match(prompt, /src\/a.ts/);
  assert.match(prompt, /startLine/);
  assert.match(prompt, /file-level comment/i);
  assert.match(prompt, /line\/range comment/i);
  assert.match(prompt, /comment-1/);
  assert.match(prompt, /thread-1/);
  assert.match(prompt, /must call the diff_review_reply tool/i);
  assert.match(prompt, /do not reply only with freeform chat text/i);
});

test("reply tool accepts thread target with path and optional line reference", async () => {
  const store = createReviewSessionStore();
  const session = store.create(makeSessionSeed());
  const result = await recordReply(store, {
    reviewSessionId: session.reviewSessionId,
    submissionRoundId: "round-1",
    threadId: "thread-1",
    path: "src/a.ts",
    line: { startLine: 4, endLine: 6, targetSide: "new" },
    reply: "Looks good",
  });
  assert.equal(result.path, "src/a.ts");
  assert.equal(result.line?.startLine, 4);
});

test("reply tool rejects malformed or unknown payloads", async () => {
  const store = createReviewSessionStore();
  const session = store.create(makeSessionSeed());
  await assert.rejects(() => recordReply(store, { reviewSessionId: "wrong", submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /review session/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "wrong", threadId: "thread-1", path: "src/a.ts", reply: "x" }), /submission round/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", path: "src/a.ts", reply: "x" }), /threadId or commentId/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", commentId: "comment-1", path: "src/a.ts", reply: "x" }), /exactly one/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "missing", path: "src/a.ts", reply: "x" }), /thread/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", commentId: "missing", path: "src/a.ts", reply: "x" }), /comment/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", reply: "x" }), /path/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", reply: "" }), /reply/i);
  await assert.rejects(() => recordReply(store, { reviewSessionId: session.reviewSessionId, submissionRoundId: "round-1", threadId: "thread-1", path: "src/a.ts", line: { startLine: 6, endLine: 4, targetSide: "new" }, reply: "x" }), /line/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-state.test.mjs test/extensions/diff-review-prompt.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: FAIL because store/prompt/reply-tool modules do not exist yet.

- [ ] **Step 3: Implement minimal state/prompt/reply-tool support**

Core requirements:
- `createReviewSessionStore()` with `(piSessionKey, repoRoot)` keys
- `serverSecret`, `pendingSubmission`, `submissionHistory`, `nextSubmissionRound`
- `startSubmissionRound()` that only persists pending state after successful injection callback
- `completeSubmissionRound()` and/or equivalent close helper that archives the round, clears `pendingSubmission`, and leaves the review ready for another submit cycle
- `recordReply()` validating `reviewSessionId`, `submissionRoundId`, mandatory `path`, exactly one target selector (`threadId` xor `commentId`), target thread/comment existence, optional line-reference shape (`startLine`, `endLine`, `targetSide`), and required plain-text reply content
- `buildReviewPrompt()` with one synthesized message that includes `reviewSessionId`, `submissionRoundId`, `diffMode`, file references, line references, file-level comments, line/range comments, stable comment ids, and explicit `diff_review_reply` instructions that tell Pi to call the tool instead of replying only in freeform chat
- `index.ts` should delegate tool registration to `reply-tool.ts`

```ts
export async function submitReviewRound(session, injectMessage) {
  if (session.pendingSubmission) throw new Error("Review submission already pending");
  const round = makeSubmissionRound(session);
  const prompt = buildReviewPrompt(session, round);
  await injectMessage(prompt);
  session.pendingSubmission = round;
  markThreadsSubmitted(session, round.id);
  return round;
}

export function completeSubmissionRound(session, roundId) {
  if (session.pendingSubmission?.id !== roundId) return;
  session.submissionHistory.push({ ...session.pendingSubmission, completedAt: Date.now() });
  session.pendingSubmission = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-state.test.mjs test/extensions/diff-review-prompt.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add pi-extension/diff-review/index.ts pi-extension/diff-review/types.ts pi-extension/diff-review/state.ts pi-extension/diff-review/prompt.ts pi-extension/diff-review/reply-tool.ts test/extensions/diff-review-state.test.mjs test/extensions/diff-review-prompt.test.mjs test/extensions/diff-review-extension.test.mjs
git commit -m "feat: add diff review session and prompt flow"
```

### Task 3: Git diff provider and repo tree loading

**Files:**
- Create: `pi-extension/diff-review/git.ts`
- Modify: `pi-extension/diff-review/types.ts`
- Test: `test/extensions/diff-review-git.test.mjs`

- [ ] **Step 1: Write the failing git-provider tests**

```js
test("working-tree mode reports whole repo tree and changed-file set", async () => {
  const repo = await createTempRepoFixture();
  await repo.write("src/a.ts", "export const a = 2;\n");
  const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
  const tree = await provider.loadTree();
  assert.ok(tree.paths.includes("src/a.ts"));
  assert.ok(tree.changedPaths.includes("src/a.ts"));
});

test("merge-base mode returns a clean fallback result when merge-base is unavailable", async () => {
  const repo = await createTempRepoFixture({ detached: true });
  const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "merge-base-vs-head" });
  const state = await provider.loadModeState();
  assert.equal(state.effectiveMode, "working-tree-vs-head");
  assert.match(state.warning ?? "", /merge-base/i);
});

test("provider fails clearly outside a git repo", async () => {
  await assert.rejects(() => createDiffProvider({ repoRoot: "/tmp/not-a-repo", diffMode: "working-tree-vs-head" }), /git repo/i);
});

test("working-tree mode surfaces missing HEAD clearly", async () => {
  const repo = await createTempRepoFixture({ noHeadCommit: true });
  const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
  await assert.rejects(() => provider.loadTree(), /HEAD/i);
});

test("unreadable files are flagged instead of crashing file load", async () => {
  const repo = await createTempRepoFixture({ unreadableFile: "secret.txt" });
  const provider = await createDiffProvider({ repoRoot: repo.root, diffMode: "working-tree-vs-head" });
  const file = await provider.loadFile("secret.txt");
  assert.equal(file.loadError?.code, "unreadable");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-git.test.mjs`
Expected: FAIL because `git.ts` does not exist.

- [ ] **Step 3: Implement minimal diff-provider layer**

Required behavior:
- `createDiffProvider({ repoRoot, diffMode })`
- `loadTree()` returns all repo paths plus changed-file metadata
- `loadFile(path)` returns current/old/new content, file status, binary flags, and readable load errors when content cannot be accessed
- `loadModeState()` returns requested mode, effective mode, and optional fallback warning
- modes:
  - `working-tree-vs-head`
  - `merge-base-vs-head`
- if merge-base resolution fails, surface a warning and fall back cleanly to working-tree mode rather than crashing the review flow
- fail clearly for missing git repo and missing `HEAD`
- shell out via `git` with clear errors

```ts
export async function loadTree() {
  const allPaths = await listTrackedAndUntrackedPaths(repoRoot);
  const changed = await listChangedPathsAgainstBase(repoRoot, diffMode);
  return { paths: allPaths, changedPaths: [...changed] };
}
```

Keep parsing logic small and deterministic. Support `modified`, `added`, `deleted`, `renamed`, `binary`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-git.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add pi-extension/diff-review/git.ts pi-extension/diff-review/types.ts test/extensions/diff-review-git.test.mjs
git commit -m "feat: add diff review git provider"
```

### Task 4: Loopback server, JSON API, SSE, and command behavior

**Files:**
- Create: `pi-extension/diff-review/server.ts`
- Create: `pi-extension/diff-review/cleanup.ts`
- Modify: `pi-extension/diff-review/index.ts`
- Modify: `pi-extension/diff-review/state.ts`
- Modify: `pi-extension/diff-review/reply-tool.ts`
- Test: `test/extensions/diff-review-server.test.mjs`
- Modify: `test/extensions/diff-review-extension.test.mjs`

- [ ] **Step 1: Write the failing server and command tests**

```js
test("server binds to loopback and rejects missing secret", async () => {
  const { baseUrl } = await startTestServer();
  const response = await fetch(`${baseUrl}/api/session`);
  assert.equal(response.status, 403);
});

test("/diff-review reuses an existing session for the same repo", async () => {
  const ctx = makeCommandContext({ piSessionKey: "s1", cwd: "/repo" });
  await runDiffReview(ctx);
  await runDiffReview(ctx);
  assert.equal(createdServerCount, 1);
});

test("submit rejects while the Pi session is busy before mutating state", async () => {
  const session = makeReviewSession();
  const result = await postSubmitWhileBusy(session);
  assert.equal(result.status, 409);
  assert.equal(session.pendingSubmission, null);
});

test("completing a Pi round clears pending state and enables another submit", async () => {
  const session = makeReviewSessionWithPendingRound();
  await postRoundComplete(session, session.pendingSubmission.id);
  assert.equal(session.pendingSubmission, null);
  const next = await postSubmitWithIdlePi(session);
  assert.equal(next.status, 200);
});

test("diff-mode switch falls back to working-tree mode when merge-base fails", async () => {
  const response = await postDiffMode({ requestedMode: "merge-base-vs-head", fixture: "no-merge-base" });
  assert.equal(response.status, 200);
  assert.equal(response.body.effectiveMode, "working-tree-vs-head");
  assert.match(response.body.warning, /merge-base/i);
});

test("server returns clear repo error when cwd is not a git repo", async () => {
  const response = await openSessionForCwd("/tmp/not-a-repo");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /git repo/i);
});

test("server surfaces unreadable file payloads without crashing", async () => {
  const response = await getFilePayload({ fixture: "unreadable-file", path: "secret.txt" });
  assert.equal(response.status, 200);
  assert.equal(response.body.loadError.code, "unreadable");
});

test("server startup reports port conflicts clearly", async () => {
  await assert.rejects(() => startConflictingTestServer(), /port/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-server.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: FAIL because the server and command behavior are not implemented.

- [ ] **Step 3: Implement minimal server and command flow**

Requirements:
- bind to `127.0.0.1`
- per-session `serverSecret` required on every JSON/SSE route
- `/diff-review` resolves repo root, reuses or creates session, starts server, and notifies URL
- `/diff-review` and bootstrap routes fail clearly when `cwd` is not inside a git repo or when repo state is missing `HEAD`
- `POST /api/submit` enforces idle/busy checks before any state mutation
- add an explicit round-completion path that marks a submission round complete, archives it, clears `pendingSubmission`, and emits a session-state event so later submits are allowed
- `/api/diff-mode` returns both requested/effective mode and surfaces merge-base fallback warnings without breaking the session
- file routes surface unreadable/binary/deleted cases as structured payloads rather than crashing the server
- server startup detects and reports port conflicts clearly
- SSE emits reply and session-state events
- `session_shutdown` cleans up all sessions for the current Pi session key and broadcasts an explicit session-closed event for stale browser tabs

```ts
if (!isAuthorized(req, session.serverSecret)) {
  return json(res, 403, { error: "invalid review secret" });
}
```

Prefer small helpers:
- `startReviewServer(session, deps)`
- `handleApiRequest(req, res, session)`
- `broadcastEvent(session, event)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-server.test.mjs test/extensions/diff-review-extension.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add pi-extension/diff-review/index.ts pi-extension/diff-review/state.ts pi-extension/diff-review/reply-tool.ts pi-extension/diff-review/server.ts pi-extension/diff-review/cleanup.ts test/extensions/diff-review-server.test.mjs test/extensions/diff-review-extension.test.mjs
git commit -m "feat: add diff review server and command flow"
```

### Task 5: Frontend source, Pierre adapters, and committed static bundle

**Files:**
- Create: `pi-extension/diff-review/web/index.html`
- Create: `pi-extension/diff-review/web/vite.config.ts`
- Create: `pi-extension/diff-review/web/src/main.tsx`
- Create: `pi-extension/diff-review/web/src/App.tsx`
- Create: `pi-extension/diff-review/web/src/api.ts`
- Create: `pi-extension/diff-review/web/src/types.ts`
- Create: `pi-extension/diff-review/web/src/state/review-session.ts`
- Create: `pi-extension/diff-review/web/src/components/ReviewLayout.tsx`
- Create: `pi-extension/diff-review/web/src/components/RepoTreePanel.tsx`
- Create: `pi-extension/diff-review/web/src/components/FilterBar.tsx`
- Create: `pi-extension/diff-review/web/src/components/DiffToolbar.tsx`
- Create: `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- Create: `pi-extension/diff-review/web/src/components/CommentComposer.tsx`
- Create: `pi-extension/diff-review/web/src/components/CommentThread.tsx`
- Create: `pi-extension/diff-review/web/src/components/CommentSidebar.tsx`
- Create: `pi-extension/diff-review/web/src/components/EmptyState.tsx`
- Create: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- Create: `pi-extension/diff-review/web/src/adapters/pierre-trees.tsx`
- Create/Modify: `pi-extension/diff-review/static/*`
- Modify: `package.json`
- Test: `test/extensions/diff-review-web-smoke.test.mjs`

- [ ] **Step 1: Write the failing frontend smoke and build verification tests**

```js
test("verify:diff-review-web script exists", () => {
  assert.equal(typeof packageJson.scripts["build:diff-review-web"], "string");
  assert.equal(typeof packageJson.scripts["verify:diff-review-web"], "string");
});

test("frontend review-session state supports bootstrap, file select, draft comment, and reply rendering", async () => {
  const state = createReviewSessionState(makeBootstrapPayload());
  state.selectPath("src/a.ts");
  state.startDraft(makeLineAnchor("src/a.ts", 4));
  state.applyReply(makeReplyEvent("thread-1", "Looks good"));
  assert.equal(state.selectedPath, "src/a.ts");
  assert.equal(state.draft.anchor.startLine, 4);
  assert.equal(state.threads[0].replies.at(-1)?.text, "Looks good");
});

test("frontend review-session state surfaces stale-tab session-closed state", async () => {
  const state = createReviewSessionState(makeBootstrapPayload());
  state.applySessionClosed(makeSessionClosedEvent("session ended"));
  assert.equal(state.connectionState, "closed");
  assert.match(state.errorMessage ?? "", /session ended/i);
});

test("verify:diff-review-web fails when committed static assets drift", async () => {
  await assert.rejects(() => runVerifyWithDirtyStaticFixture(), /static assets are stale/i);
});
```

Also add a server test assertion that `GET /` serves an HTML shell from `static/` after the build.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-server.test.mjs test/extensions/diff-review-web-smoke.test.mjs`
Expected: FAIL because the frontend build, frontend state helpers, and static-drift verification are not implemented.

- [ ] **Step 3: Implement the minimal browser app and build pipeline**

Requirements:
- React app bootstraps from `/api/session`
- left tree shows whole repo with changed-file highlighting/filtering
- center pane shows full-file diff/current-file content via `@pierre/diffs`
- right pane shows threads, comment composer, submit state, and Pi replies
- browser uses SSE to receive updates
- frontend state module is testable without the DOM so smoke coverage can exercise bootstrap, file selection, draft comment creation, merge-base warning display, reply application, and stale-tab session-closed handling
- the browser must show a clear reconnect/session-closed error state when it receives a shutdown or expired-session event from SSE/API
- `npm run build:diff-review-web` writes committed assets to `pi-extension/diff-review/static/`
- `npm run verify:diff-review-web` rebuilds and fails if `static/` is stale
- add a negative verification fixture or helper so stale committed assets produce a red test before the implementation makes the verify script pass

Minimal adapter shape:

```tsx
export function PierreTreeAdapter(props: RepoTreePanelProps) {
  return <TreeView items={props.items} onSelect={props.onSelect} />;
}

export function PierreDiffAdapter(props: DiffViewerProps) {
  return <MultiFileDiff files={props.files} />;
}
```

Keep CSS simple. Prioritize correctness over polish.

- [ ] **Step 4: Run build and tests to verify they pass**

Run:
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && npm run build:diff-review-web`
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && npm run verify:diff-review-web`
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-server.test.mjs test/extensions/diff-review-web-smoke.test.mjs`
Expected: PASS; `verify:diff-review-web` should exit 0 with no diff in `pi-extension/diff-review/static/`, and the smoke test should cover bootstrap, file selection, draft comment state, reply rendering, and stale-asset detection.

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add package.json package-lock.json pi-extension/diff-review/web pi-extension/diff-review/static test/extensions/diff-review-manifest.test.mjs test/extensions/diff-review-server.test.mjs
git commit -m "feat: add diff review web ui"
```

### Task 6: Final integration docs and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `test/extensions/diff-review-extension.test.mjs`
- Modify: `test/extensions/diff-review-server.test.mjs`
- Modify: `test/extensions/diff-review-state.test.mjs`

- [ ] **Step 1: Write one final failing integration/doc expectation**

```js
test("README documents /diff-review session scope and local build", async () => {
  const readme = await fs.promises.readFile(new URL("../../README.md", import.meta.url), "utf8");
  assert.match(readme, /\/diff-review/);
  assert.match(readme, /session-scoped/i);
  assert.match(readme, /build:diff-review-web/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && node --test test/extensions/diff-review-extension.test.mjs`
Expected: FAIL because docs/final expectations are not complete yet.

- [ ] **Step 3: Finish integration and docs**

Add README coverage for:
- `/diff-review` command
- loopback-only browser URL behavior
- same-session/same-repo reuse semantics
- ephemeral review state
- `build:diff-review-web` and `verify:diff-review-web`

Then tighten final integration tests so they cover:
- same Pi session + same repo => reuse
- same Pi session + different repo => different session
- busy submit => no pending round
- round completion => pending state clears and a later submit succeeds
- reply-tool update => visible state change/event
- malformed/unknown reply payloads => rejected cleanly
- merge-base fallback => warning surfaces and effective mode returns to working-tree
- session shutdown => stale browser state becomes session-closed/reconnect-required
- missing git repo, missing `HEAD`, unreadable file payloads, and port conflicts => clear user-facing errors

- [ ] **Step 4: Run full verification**

Run:
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && npm run build:diff-review-web`
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && npm run verify:diff-review-web`
- `cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web && npm test`

Expected:
- build succeeds
- verify script exits 0
- `npm test` exits 0 with all diff-review and existing tests passing

- [ ] **Step 5: Commit**

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
git add README.md test/extensions/diff-review-extension.test.mjs test/extensions/diff-review-server.test.mjs test/extensions/diff-review-state.test.mjs
git commit -m "docs: finalize diff review replacement"
```

## Notes for implementation

- Use `pi.sendUserMessage()` for review submission injection, but only after checking the session is idle. Do not queue or steer in v1.
- Prefer SSE over websockets unless Pierre integration forces a change.
- Use `@sinclair/typebox` for reply-tool parameters if the local extension API expects the same schema style as other Pi examples.
- Keep comments and Pi replies as simple flat records; do not add resolution state in v1.
- If `@pierre/diffs` or `@pierre/trees` has a surprising integration constraint, adapt only inside `web/src/adapters/`.
- Do not touch unrelated modified files from the parent worktree.

# Diff Review Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit Pi round completion, inline thread replies, distinct file-vs-line comment entry points, real diff-based line/range selection, and light UI polish to the local `/diff-review` experience.

**Architecture:** Reuse the existing local diff-review extension and browser app. Extend the existing session/thread model with user follow-up replies and explicit round-completion semantics, then wire the current React UI and Pierre diff adapter to emit real selections and render a flatter, collapsible thread timeline.

**Tech Stack:** TypeScript, Node test runner, React, existing local diff-review extension, `@pierre/diffs`, existing SSE/API flow.

---

## File map

### Backend/extension
- Modify: `pi-extension/diff-review/types.ts` — add explicit completion params and thread reply/user-follow-up types
- Modify: `pi-extension/diff-review/state.ts` — snapshot pending submission item ids, persist user replies, stricter completion handling
- Modify: `pi-extension/diff-review/prompt.ts` — mention optional replies plus required explicit completion
- Modify: `pi-extension/diff-review/reply-tool.ts` — register reply + completion tools and validate active round
- Modify: `pi-extension/diff-review/server.ts` — add thread-reply API and emit unlocked session state after completion
- Modify: `pi-extension/diff-review/index.ts` — register completion tool

### Frontend
- Modify: `pi-extension/diff-review/web/src/types.ts` — represent file/line/range/reply drafts and thread timeline entries
- Modify: `pi-extension/diff-review/web/src/api.ts` — add thread-reply requests
- Modify: `pi-extension/diff-review/web/src/state/review-session.ts` — manage file-comment drafts, reply drafts, collapse state, selected anchors
- Modify: `pi-extension/diff-review/web/src/App.tsx` — connect new draft flows, reply save flow, and diff selection events
- Modify: `pi-extension/diff-review/web/src/components/CommentComposer.tsx` — show file/line/range draft labels and file-comment CTA
- Modify: `pi-extension/diff-review/web/src/components/CommentSidebar.tsx` — expose file-comment entry point and per-thread actions
- Modify: `pi-extension/diff-review/web/src/components/CommentThread.tsx` — collapse/expand, inline reply composer, flat chronology
- Modify: `pi-extension/diff-review/web/src/components/DiffToolbar.tsx` — rename CTA to `Submit feedback`
- Modify: `pi-extension/diff-review/web/src/components/DiffViewer.tsx` — surface selection callbacks
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx` — reuse Pierre selection APIs instead of hardcoded anchors

### Tests
- Modify: `test/extensions/diff-review-state.test.mjs`
- Modify: `test/extensions/diff-review-prompt.test.mjs`
- Modify: `test/extensions/diff-review-extension.test.mjs`
- Modify: `test/extensions/diff-review-server.test.mjs`
- Modify: `test/extensions/diff-review-web-smoke.test.mjs`

### Generated assets
- Modify if needed: `pi-extension/diff-review/static/*`

## Task 1: Backend round completion and thread-reply model

**Files:**
- Modify: `pi-extension/diff-review/types.ts`
- Modify: `pi-extension/diff-review/state.ts`
- Modify: `pi-extension/diff-review/prompt.ts`
- Modify: `pi-extension/diff-review/reply-tool.ts`
- Modify: `pi-extension/diff-review/index.ts`
- Modify: `test/extensions/diff-review-state.test.mjs`
- Modify: `test/extensions/diff-review-prompt.test.mjs`
- Modify: `test/extensions/diff-review-extension.test.mjs`

- [ ] **Step 1: Write failing backend tests for completion-tool and reply snapshot behavior**
- [ ] **Step 2: Run the targeted backend tests and verify they fail for the expected reasons**
- [ ] **Step 3: Implement minimal backend changes to pass those tests while reusing existing store/tool code**
- [ ] **Step 4: Re-run targeted backend tests and verify they pass**

## Task 2: Server API support for user thread replies

**Files:**
- Modify: `pi-extension/diff-review/server.ts`
- Modify: `test/extensions/diff-review-server.test.mjs`

- [ ] **Step 1: Write failing server tests for creating user replies within an existing thread and for stale completion rejection**
- [ ] **Step 2: Run the targeted server tests and verify they fail**
- [ ] **Step 3: Implement the minimal server/API changes**
- [ ] **Step 4: Re-run targeted server tests and verify they pass**

## Task 3: Frontend state for file comments, reply drafts, and collapse state

**Files:**
- Modify: `pi-extension/diff-review/web/src/types.ts`
- Modify: `pi-extension/diff-review/web/src/state/review-session.ts`
- Modify: `test/extensions/diff-review-web-smoke.test.mjs`

- [ ] **Step 1: Write failing frontend-state tests for file-comment drafts, reply drafts, real anchors, and collapse toggles**
- [ ] **Step 2: Run the targeted frontend-state tests and verify they fail**
- [ ] **Step 3: Implement the minimal state changes**
- [ ] **Step 4: Re-run targeted frontend-state tests and verify they pass**

## Task 4: UI wiring and Pierre selection integration

**Files:**
- Modify: `pi-extension/diff-review/web/src/api.ts`
- Modify: `pi-extension/diff-review/web/src/App.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentComposer.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentSidebar.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentThread.tsx`
- Modify: `pi-extension/diff-review/web/src/components/DiffToolbar.tsx`
- Modify: `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- Modify: `test/extensions/diff-review-web-smoke.test.mjs`

- [ ] **Step 1: Add failing smoke/state expectations for submit label, reply UI flows, and selected anchors**
- [ ] **Step 2: Run the targeted smoke tests and verify they fail**
- [ ] **Step 3: Implement the minimal UI changes, using Pierre line-selection callbacks instead of a custom diff surface**
- [ ] **Step 4: Build the web bundle if needed and re-run smoke tests**

## Task 5: Final verification

**Files:**
- Modify as needed: `pi-extension/diff-review/static/*`

- [ ] **Step 1: Run `npm run build:diff-review-web` if frontend assets changed**
- [ ] **Step 2: Run `npm run verify:diff-review-web`**
- [ ] **Step 3: Run `npm test`**
- [ ] **Step 4: Inspect output before making completion claims**

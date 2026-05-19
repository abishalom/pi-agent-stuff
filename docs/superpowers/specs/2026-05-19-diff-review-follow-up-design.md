# Diff review follow-up design

Date: 2026-05-19

## Goal

Refine the local `/diff-review` workflow so follow-up review rounds behave naturally: Pi explicitly unlocks the round when it is done, users can reply inline to existing threads, file-level comments are clearly distinct from line/range comments, and the browser uses real diff selections instead of a hardcoded line-1 anchor.

## Why this work is needed

The current browser workflow works for the first round but has three major UX gaps:

1. the review stays locked after submit because pending state only clears through a completion path the browser never triggers
2. threads render Pi replies read-only, so the user cannot reply inline to the same thread
3. line comments do not use real diff selection and currently default to `startLine=1, endLine=1, targetSide=new`

These issues make repeated review cycles confusing and cause the prompt Pi receives to misrepresent the user’s selected lines.

## Requirements

### Round completion and unlock

- Submitting feedback still creates exactly one active submission round at a time.
- Pi may reply to any subset of threads in the round, including zero threads.
- The round must unlock only when Pi explicitly marks the round complete.
- Unlocking must not be inferred from reply count, first reply arrival, or any heuristic.
- While a round is pending, the browser may continue to collect new file comments, line/range comments, and thread replies, but those additions belong to the next round and do not change the in-flight round.

### Thread replies

- Each thread must expose a direct `Reply` action.
- User replies stay in the same thread rather than creating a new root thread.
- A reply inherits the thread’s existing file path and line/range anchor.
- Thread display stays one-level and chronological: root comment, then replies in order.
- Each thread must support collapse/expand with a lightweight `+` / `-` affordance.

### File-level vs line/range comments

- The browser must expose a dedicated top-level `File comment` action.
- Line/range comments must come from interaction with the diff viewer.
- The composer must clearly identify the draft type:
  - `File comment · <path>`
  - `Line comment · <path>:<line>`
  - `Range comment · <path>:<start>-<end>`
- The implementation must not silently fall back to line 1 when no valid line selection exists.

### Styling

- Apply a light styling pass to the main controls and thread/composer surfaces.
- Keep styling incremental and subordinate to the behavior changes.
- Rename the main CTA to `Submit feedback`.

## Chosen approach

Extend the existing local diff-review architecture rather than replacing it:

- keep the current in-memory session store, loopback server, SSE updates, and React/Vite app
- add an explicit Pi completion signal for submission rounds
- upgrade the thread model to support user replies in-thread
- add frontend state for inline reply drafts and collapsed threads
- wire actual diff viewer line/range selection into comment creation
- continue using the existing `@pierre/diffs` and `@pierre/trees` integration points through the adapter layer instead of building custom viewers

## Reuse rules

This work should reuse existing code and upstream primitives wherever practical.

### Reuse existing local code first

Prefer targeted changes to these existing units instead of replacing them:

- `pi-extension/diff-review/state.ts` for round lifecycle and thread state
- `pi-extension/diff-review/prompt.ts` for Pi instructions
- `pi-extension/diff-review/reply-tool.ts` for structured bridge semantics
- `pi-extension/diff-review/server.ts` for API and SSE behavior
- `pi-extension/diff-review/web/src/state/review-session.ts` for client session state
- `pi-extension/diff-review/web/src/components/*` for UI changes
- `pi-extension/diff-review/web/src/adapters/*` for Pierre package integration

### Reuse upstream/browser dependencies where they fit

- Keep using `@pierre/diffs` for diff rendering and line/range selection if the package exposes a usable hook/event path.
- Keep using `@pierre/trees` through the existing tree adapter.
- If Pierre packages expose selection metadata or comment-friendly callbacks, adapt them in the local adapter layer rather than reimplementing a diff surface.
- Only add custom selection plumbing where the upstream packages do not provide the needed information.

## Architecture changes

### 1. Explicit round-completion contract

Add a dedicated completion mechanism alongside `diff_review_reply`.

Pi contract:
- Pi may call `diff_review_reply` zero or more times for the active round.
- Pi must explicitly complete the round when done, even if it produced zero replies.
- The completion signal must include `reviewSessionId` and `submissionRoundId` and must only affect the active round.

Store/server behavior:
- keep `pendingSubmission` until the explicit completion signal arrives
- archive the finished round to `submissionHistory`
- emit a session-state update so the browser re-enables `Submit feedback`
- reject stale or mismatched completion payloads

### 2. Thread model extension

Preserve one-level threads but allow user replies to existing threads.

Each thread now conceptually contains:
- one root user comment
- zero or more replies from either side, in chronological order

For this follow-up, replies remain plain text and inherit the thread anchor. Nested subthreads, resolution state, and rich reply types remain out of scope.

### 3. Browser draft model

The client must track three distinct draft types:

- draft file comment
- draft line/range comment
- draft thread reply

This avoids conflating the top-level composer with inline reply state and makes pending-round behavior predictable.

### 4. Collapsed-thread UI state

Collapsed/expanded state is browser-local UI state keyed by thread id. It does not need server persistence.

## Detailed runtime behavior

### Submit lifecycle

1. User drafts comments/replies in the browser.
2. User clicks `Submit feedback`.
3. Server snapshots the current eligible open items into a new `submissionRoundId`.
4. Server injects one synthesized prompt into Pi.
5. The session becomes pending only after injection succeeds.
6. Pi sends zero or more structured reply calls.
7. Pi explicitly completes the round.
8. Server clears pending state and broadcasts the unlocked session state.

### Pending behavior

While pending:
- disable `Submit feedback`
- allow new file comments
- allow new line/range comments
- allow inline thread replies
- allow collapse/expand interactions
- do not merge newly created drafts into the in-flight round

### File comment entry point

The right sidebar gets a dedicated `File comment` action associated with the currently selected file.

### Line/range comment entry point

The diff viewer must expose the selected line/range anchor to the app state. Click yields a single-line draft; drag/range selection yields a multi-line draft.

## Prompt contract changes

The prompt synthesized for Pi must clearly state:

- replies are optional per thread
- Pi may reply to any subset of threads, including none
- Pi must use the structured reply tool for any replies
- Pi must explicitly complete the round when finished, even if no replies were sent
- the unlock condition is explicit completion, not reply count

The prompt should remain concise but unambiguous. This requirement is critical because unlock correctness depends on Pi understanding the completion contract.

## Error handling

Handle these cases explicitly:

- Pi replies but never completes the round: keep the round pending and show a clear waiting message
- Pi completes without replying: unlock normally
- Pi replies to only some threads: render those replies and wait for completion
- stale or mismatched completion signal: reject and keep current pending state intact
- invalid line selection: do not create a line comment with a fake line-1 anchor
- browser reconnect after refresh: restore saved thread/reply state from server session state

Draft persistence across browser refresh is out of scope for this pass; drafts may remain in-memory only.

## Frontend design

### Main controls

- top toolbar CTA label: `Submit feedback`
- top/right action for file-level comments: `File comment`
- thread cards show a lightweight `+` / `-` collapse toggle
- each thread card shows a `Reply` action

### Thread card layout

Expanded thread:
- path and optional line/range summary
- root comment
- replies in chronological order with author label
- inline reply composer when `Reply` is active

Collapsed thread:
- compact path/anchor summary
- root-comment preview
- reply count indicator if helpful

## Testing strategy

### Server/state tests

Add coverage for:
- explicit round completion unlocks the browser state
- zero-reply completion is valid
- partial replies plus completion unlock correctly
- stale completion payloads are rejected
- pending rounds do not absorb drafts created after submission
- reply drafts inherit the thread anchor

### Prompt tests

Add coverage proving the prompt requires:
- `diff_review_reply` for replies
- explicit round completion even when there are zero replies

### Frontend state tests

Add coverage for:
- file-level draft creation via dedicated action
- line/range drafts use selected anchors rather than line 1
- inline reply drafts stay attached to the target thread
- collapsed-thread UI state toggles by thread id
- pending sessions disable submit but still allow drafting

### Browser/smoke tests

Verify at least:
- file-level comment flow
- line comment flow
- Pi reply rendering in-thread
- explicit completion unlocks submit for the next round
- previous round replies remain visible after a second submission

## Non-goals

This pass does not add:
- nested thread trees
- persistent storage
- draft persistence across browser refresh
- comment resolution states
- rich text or markdown replies
- major visual redesign beyond light polish

## Verification checklist

Before calling the follow-up complete, verify:

- a pending round stays locked until Pi explicitly completes it
- a zero-reply round can still unlock correctly
- users can reply directly inside an existing thread
- reply drafts inherit the existing thread anchor
- a dedicated `File comment` action exists and is distinct from line/range commenting
- line/range comments use real diff selection data
- no line comment is silently created for line 1 without an actual selection
- `Submit feedback` re-enables after explicit completion
- collapsed threads can be expanded again without losing content
- prior replies remain visible across multiple rounds

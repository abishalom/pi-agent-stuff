# Pierre Reuse Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse more of Pierre’s native tree/diff capabilities by replacing tree remounts with model mutation, adding inline diff annotations for anchored threads, and using Pierre gutter utilities for single-line comment entry.

**Architecture:** Keep the existing diff-review domain model and Pi protocol unchanged. Concentrate the follow-up inside the Pierre adapter layer and small client-state additions: the tree adapter will mutate a long-lived Pierre tree model, the diff adapter will derive Pierre line annotations from review threads, and the diff adapter will use Pierre’s gutter utility hook to start single-line comment drafts without custom overlay logic.

**Tech Stack:** TypeScript, React, `@pierre/trees`, `@pierre/diffs`, Node test runner.

---

## Scope

This plan covers the three approved follow-ups:

- **A. Tree model mutation instead of remounting**
- **B. Inline diff annotations for anchored threads**
- **C. Pierre gutter utility for single-line comment entry**

It does **not** change the review-round protocol, Pi completion semantics, or server storage model.

## Pierre APIs to reuse

### Tree
- `useFileTree(options)`
- `FileTree.resetPaths(paths, options?)`
- `FileTree.setGitStatus(gitStatus)`
- `FileTree.focusPath(path)`
- `FileTree.getItem(path)?.select()`
- `preparePresortedFileTreeInput(paths)`

### Diffs
- `lineAnnotations`
- `renderAnnotation`
- `renderGutterUtility`
- `enableGutterUtility`
- `onGutterUtilityClick(range)`
- `enableLineSelection`
- `onLineSelected(range)`

## File map

### Tree adapter work
- Modify: `pi-extension/diff-review/web/src/components/RepoTreePanel.tsx`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-trees.tsx`
- Delete or stop using: `pi-extension/diff-review/web/src/state/repo-tree.ts`
- Create: `pi-extension/diff-review/web/src/adapters/pierre-tree-model.ts`

### Diff annotation + gutter work
- Modify: `pi-extension/diff-review/web/src/App.tsx`
- Modify: `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentSidebar.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentThread.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentComposer.tsx`
- Modify: `pi-extension/diff-review/web/src/state/review-session.ts`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.ts`
- Create: `pi-extension/diff-review/web/src/adapters/diff-review-annotations.ts`
- Modify: `pi-extension/diff-review/web/src/ui.ts`

### Tests
- Modify: `test/extensions/diff-review-web-smoke.test.mjs`

---

## Task 1: Replace tree remounting with Pierre model mutation

**Files:**
- Modify: `pi-extension/diff-review/web/src/components/RepoTreePanel.tsx`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-trees.tsx`
- Create: `pi-extension/diff-review/web/src/adapters/pierre-tree-model.ts`
- Delete or stop using: `pi-extension/diff-review/web/src/state/repo-tree.ts`
- Test: `test/extensions/diff-review-web-smoke.test.mjs`

### Exact code changes

#### 1.1 Remove the remount key from `RepoTreePanel.tsx`

**Current code** remounts the entire tree whenever the paths or git-status payload changes:

```tsx
return <div style={{ height: "100%", overflow: "hidden" }}><PierreRepoTree key={createRepoTreeModelKey(paths, changedFiles)} paths={paths} changedFiles={changedFiles} selectedPath={selectedPath} onSelect={onSelect} /></div>;
```

**Change it to**:

```tsx
return (
  <div style={{ height: "100%", overflow: "hidden" }}>
    <PierreRepoTree
      paths={paths}
      changedFiles={changedFiles}
      selectedPath={selectedPath}
      onSelect={onSelect}
    />
  </div>
);
```

Then delete `createRepoTreeModelKey(...)` usage and remove `state/repo-tree.ts` if nothing else imports it.

#### 1.2 Move Pierre tree syncing into a helper file

Create `web/src/adapters/pierre-tree-model.ts` with three small helpers so the adapter is declarative and testable:

```ts
import { preparePresortedFileTreeInput } from "@pierre/trees";
import type { DiffTreeEntry } from "../types.ts";

export function toPierreGitStatus(changedFiles: DiffTreeEntry[]) {
  return changedFiles.map((file) => ({
    path: file.path,
    status: file.status === "binary" ? "modified" : file.status,
  }));
}

export function prepareTreeInput(paths: string[]) {
  return preparePresortedFileTreeInput(paths);
}

export function syncPierreTreeModel(model: {
  resetPaths(paths: readonly string[], options?: { preparedInput?: unknown }): void;
  setGitStatus(entries?: readonly { path: string; status: string }[]): void;
  focusPath(path: string): void;
  getItem(path: string): { select(): void } | null;
}, args: {
  paths: string[];
  changedFiles: DiffTreeEntry[];
  selectedPath: string | null;
  preparedInput: unknown;
}) {
  model.resetPaths(args.paths, { preparedInput: args.preparedInput });
  model.setGitStatus(toPierreGitStatus(args.changedFiles));
  if (args.selectedPath) {
    model.focusPath(args.selectedPath);
    model.getItem(args.selectedPath)?.select();
  }
}
```

The helper exists mainly so tests can verify mutation behavior without rendering the tree.

#### 1.3 Update `pierre-trees.tsx` to keep one live Pierre model

**Current code** recreates behavior through remounting. Replace it with:

```tsx
import { useEffect, useMemo } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { prepareTreeInput, syncPierreTreeModel, toPierreGitStatus } from "./pierre-tree-model.ts";

export function PierreRepoTree({ paths, changedFiles, selectedPath, onSelect }) {
  const preparedInput = useMemo(() => prepareTreeInput(paths), [paths]);
  const gitStatus = useMemo(() => toPierreGitStatus(changedFiles), [changedFiles]);

  const { model } = useFileTree({
    preparedInput,
    search: false,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    gitStatus,
    onSelectionChange(selectedPaths) {
      const next = selectedPaths[0];
      if (next) onSelect(next);
    },
  });

  useEffect(() => {
    syncPierreTreeModel(model, { paths, changedFiles, selectedPath, preparedInput });
  }, [model, paths, changedFiles, selectedPath, preparedInput]);

  return <FileTree model={model} style={{ height: "100%" }} />;
}
```

The exact split between `preparedInput` and `paths` can be adjusted to whatever `useFileTree()` prefers best in practice, but the important change is: **use model mutation, not remount key churn**.

### Test changes

Add adapter-level smoke tests in `test/extensions/diff-review-web-smoke.test.mjs` for the new helper module:

```js
test("syncPierreTreeModel mutates the Pierre model instead of relying on remount keys", () => {
  const calls = [];
  const model = {
    resetPaths(paths, options) {
      calls.push(["resetPaths", [...paths], options]);
    },
    setGitStatus(entries) {
      calls.push(["setGitStatus", entries]);
    },
    focusPath(path) {
      calls.push(["focusPath", path]);
    },
    getItem(path) {
      calls.push(["getItem", path]);
      return { select() { calls.push(["select", path]); } };
    },
  };

  syncPierreTreeModel(model, {
    paths: ["README.md", "src/a.ts"],
    changedFiles: [{ path: "src/a.ts", status: "modified" }],
    selectedPath: "src/a.ts",
    preparedInput: { fake: true },
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "resetPaths",
    "setGitStatus",
    "focusPath",
    "getItem",
    "select",
  ]);
});
```

Also add a test for binary status mapping:

```js
test("toPierreGitStatus maps binary entries to modified for Pierre git-status rendering", () => {
  assert.deepEqual(toPierreGitStatus([
    { path: "bin.dat", status: "binary" },
    { path: "src/a.ts", status: "modified" },
  ]), [
    { path: "bin.dat", status: "modified" },
    { path: "src/a.ts", status: "modified" },
  ]);
});
```

---

## Task 2: Add inline diff annotations for anchored threads

**Files:**
- Create: `pi-extension/diff-review/web/src/adapters/diff-review-annotations.ts`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- Modify: `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- Modify: `pi-extension/diff-review/web/src/App.tsx`
- Modify: `pi-extension/diff-review/web/src/state/review-session.ts`
- Modify: `pi-extension/diff-review/web/src/components/CommentSidebar.tsx`
- Modify: `pi-extension/diff-review/web/src/components/CommentThread.tsx`
- Modify: `pi-extension/diff-review/web/src/ui.ts`
- Test: `test/extensions/diff-review-web-smoke.test.mjs`

### Exact code changes

#### 2.1 Add a helper that maps review threads to Pierre annotations

Create `web/src/adapters/diff-review-annotations.ts`:

```ts
import type { DiffLineAnnotation, LineAnnotation } from "@pierre/diffs";
import type { ReviewThread } from "../types.ts";

export type AnnotationMetadata = {
  threadIds: string[];
  count: number;
};

export function buildDiffLineAnnotations(
  threads: ReviewThread[],
  targetSide: "old" | "new",
): DiffLineAnnotation<AnnotationMetadata>[] {
  const buckets = new Map<string, AnnotationMetadata>();

  for (const thread of threads) {
    if (!thread.root.line) continue;
    if (thread.root.line.targetSide !== targetSide) continue;
    for (let lineNumber = thread.root.line.startLine; lineNumber <= thread.root.line.endLine; lineNumber += 1) {
      const key = `${targetSide}:${lineNumber}`;
      const metadata = buckets.get(key) ?? { threadIds: [], count: 0 };
      metadata.threadIds.push(thread.id);
      metadata.count += 1;
      buckets.set(key, metadata);
    }
  }

  return [...buckets.entries()].map(([key, metadata]) => {
    const [, lineNumberText] = key.split(":");
    return {
      side: targetSide === "old" ? "deletions" : "additions",
      lineNumber: Number(lineNumberText),
      metadata,
    };
  });
}

export function buildFileLineAnnotations(threads: ReviewThread[]): LineAnnotation<AnnotationMetadata>[] {
  const buckets = new Map<number, AnnotationMetadata>();

  for (const thread of threads) {
    if (!thread.root.line) continue;
    for (let lineNumber = thread.root.line.startLine; lineNumber <= thread.root.line.endLine; lineNumber += 1) {
      const metadata = buckets.get(lineNumber) ?? { threadIds: [], count: 0 };
      metadata.threadIds.push(thread.id);
      metadata.count += 1;
      buckets.set(lineNumber, metadata);
    }
  }

  return [...buckets.entries()].map(([lineNumber, metadata]) => ({ lineNumber, metadata }));
}
```

This keeps all annotation derivation out of the JSX component.

#### 2.2 Add focus state for “annotation click => thread focus”

In `web/src/state/review-session.ts`, add browser-local focus state:

```ts
focusedThreadId: null as string | null,
focusThread(threadId: string) {
  state.focusedThreadId = threadId;
  const thread = findThread(state.threads, threadId);
  if (thread) {
    state.selectedPath = thread.path;
  }
  state.emit();
},
clearFocusedThread() {
  state.focusedThreadId = null;
  state.emit();
},
```

No server persistence is needed.

#### 2.3 Extend the diff adapter to accept threads + focus callback

In `pierre-diffs.tsx`, change the adapter signature from:

```tsx
export function PierreDiffView({ detail, selectedAnchor, onSelectAnchor })
```

to:

```tsx
export function PierreDiffView({
  detail,
  threads,
  selectedAnchor,
  focusedThreadId,
  onSelectAnchor,
  onFocusThread,
})
```

Then derive annotations:

```tsx
const fileThreads = threads.filter((thread) => thread.path === detail.path && thread.root.line);
const deletionAnnotations = buildDiffLineAnnotations(fileThreads, "old");
const additionAnnotations = buildDiffLineAnnotations(fileThreads, "new");
const fileAnnotations = buildFileLineAnnotations(fileThreads);
```

For diff mode:

```tsx
<MultiFileDiff
  oldFile={{ name: detail.previousPath ?? detail.path, contents: detail.oldContent }}
  newFile={{ name: detail.path, contents: detail.newContent }}
  selectedLines={selectedLines}
  lineAnnotations={[
    ...deletionAnnotations,
    ...additionAnnotations,
  ]}
  renderAnnotation={(annotation) => (
    <button
      type="button"
      onClick={() => onFocusThread?.(annotation.metadata.threadIds[0])}
      aria-label={`Open ${annotation.metadata.count} thread(s) on line ${annotation.lineNumber}`}
      style={{
        borderRadius: 999,
        padding: "0 6px",
        background: annotation.metadata.threadIds.includes(focusedThreadId ?? "") ? "#2563eb" : "#1e293b",
        color: "#f8fafc",
        border: "1px solid #334155",
      }}
    >
      {annotation.metadata.count}
    </button>
  )}
  ...
/>
```

For plain-file mode:

```tsx
<File
  file={{ name: detail.path, contents: detail.currentContent ?? detail.newContent ?? detail.oldContent ?? "" }}
  selectedLines={selectedLines}
  lineAnnotations={fileAnnotations}
  renderAnnotation={(annotation) => (
    <button
      type="button"
      onClick={() => onFocusThread?.(annotation.metadata.threadIds[0])}
      ...
    >
      {annotation.metadata.count}
    </button>
  )}
  ...
/>
```

#### 2.4 Thread focus wiring in `App.tsx` and sidebar

In `App.tsx`, pass current-file threads and the focus callback into `DiffViewer`:

```tsx
<DiffViewer
  detail={fileDetail}
  loading={fileLoading}
  error={fileError}
  threads={sessionState.getThreadsForSelectedPath()}
  focusedThreadId={sessionState.focusedThreadId}
  selectedAnchor={selectedAnchor}
  onSelectAnchor={(anchor) => {
    if (anchor) sessionState.startLineDraft(anchor);
  }}
  onFocusThread={(threadId) => sessionState.focusThread(threadId)}
/>
```

In `DiffViewer.tsx`, forward those props directly to `PierreDiffView`.

In `CommentSidebar.tsx` / `CommentThread.tsx`, add a visual highlight when `thread.id === focusedThreadId`.

Example `CommentThread.tsx` prop addition:

```tsx
export function CommentThread({ thread, isFocused, ... })
```

and style change:

```tsx
background: isFocused ? "#172554" : "#111827",
border: isFocused ? "1px solid #2563eb" : "1px solid #1e293b",
```

Optionally, add a `useEffect()` in `CommentThread.tsx` to scroll the focused thread into view using a `ref`.

### Test changes

Add helper-level tests in `test/extensions/diff-review-web-smoke.test.mjs`:

```js
test("buildDiffLineAnnotations groups anchored threads by side and line", () => {
  const annotations = buildDiffLineAnnotations([
    {
      id: "thread-1",
      path: "src/a.ts",
      root: {
        id: "comment-1",
        path: "src/a.ts",
        body: "one",
        status: "open",
        line: { startLine: 7, endLine: 7, targetSide: "new" },
      },
      userReplies: [],
      replies: [],
    },
    {
      id: "thread-2",
      path: "src/a.ts",
      root: {
        id: "comment-2",
        path: "src/a.ts",
        body: "two",
        status: "open",
        line: { startLine: 7, endLine: 8, targetSide: "new" },
      },
      userReplies: [],
      replies: [],
    },
  ], "new");

  assert.deepEqual(annotations, [
    { side: "additions", lineNumber: 7, metadata: { threadIds: ["thread-1", "thread-2"], count: 2 } },
    { side: "additions", lineNumber: 8, metadata: { threadIds: ["thread-2"], count: 1 } },
  ]);
});
```

Also add a state test proving annotation click focuses the thread path:

```js
test("focusThread selects the target thread path for sidebar synchronization", () => {
  const state = createReviewSessionState(makeBootstrapPayload());
  state.focusThread("thread-1");
  assert.equal(state.focusedThreadId, "thread-1");
  assert.equal(state.selectedPath, "src/a.ts");
});
```

---

## Task 3: Use Pierre gutter utility for single-line comment entry

**Files:**
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.tsx`
- Modify: `pi-extension/diff-review/web/src/adapters/pierre-diffs.ts`
- Modify: `pi-extension/diff-review/web/src/components/DiffViewer.tsx`
- Modify: `pi-extension/diff-review/web/src/App.tsx`
- Modify: `pi-extension/diff-review/web/src/ui.ts`
- Test: `test/extensions/diff-review-web-smoke.test.mjs`

### Exact code changes

#### 3.1 Add a helper to convert hovered gutter line -> anchor

Extend `pierre-diffs.ts` with:

```ts
export function hoveredLineToAnchor(
  path: string,
  hoveredLine: { lineNumber: number; side?: "additions" | "deletions" } | undefined,
  fallbackTargetSide: LineAnchor["targetSide"] = "new",
): LineAnchor | null {
  if (!hoveredLine) return null;
  const targetSide = hoveredLine.side === "deletions"
    ? "old"
    : hoveredLine.side === "additions"
      ? "new"
      : fallbackTargetSide;
  return {
    path,
    startLine: hoveredLine.lineNumber,
    endLine: hoveredLine.lineNumber,
    targetSide,
  };
}
```

Keep `selectionRangeToAnchor(...)` for drag/range selection. The gutter utility is only for single-line comments.

#### 3.2 Add a reusable gutter button renderer in `ui.ts`

Add:

```ts
export function getGutterCommentLabel() {
  return "+";
}
```

Optional, but it keeps visible copy in one place.

#### 3.3 Wire the gutter utility through Pierre diff props

In `pierre-diffs.tsx`, add for `MultiFileDiff`:

```tsx
<MultiFileDiff
  ...
  renderGutterUtility={(getHoveredLine) => {
    const anchor = hoveredLineToAnchor(detail.path, getHoveredLine());
    if (!anchor) return null;
    return (
      <button
        type="button"
        onClick={() => onSelectAnchor?.(anchor)}
        aria-label={`Add comment on ${detail.path}:${anchor.startLine}`}
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          border: "1px solid #334155",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        +
      </button>
    );
  }}
  options={{
    diffStyle: "split",
    enableLineSelection: true,
    enableGutterUtility: true,
    onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range)),
  }}
/>
```

For plain-file mode:

```tsx
<File
  ...
  renderGutterUtility={(getHoveredLine) => {
    const anchor = hoveredLineToAnchor(detail.path, getHoveredLine(), "new");
    if (!anchor) return null;
    return (
      <button type="button" onClick={() => onSelectAnchor?.(anchor)}>+</button>
    );
  }}
  options={{
    enableLineSelection: true,
    enableGutterUtility: true,
    onLineSelected: (range) => onSelectAnchor?.(selectionRangeToAnchor(detail.path, range, "new")),
  }}
/>
```

That keeps range-comment behavior exactly as-is while adding a clearer single-line affordance.

#### 3.4 Do not change file-comment flow

`File comment` remains the dedicated top-level file-scoped entry point. Gutter utility is only for single-line comments. Drag selection remains the range-comment path.

### Test changes

Add helper tests:

```js
test("hoveredLineToAnchor maps additions and deletions to the correct target side", () => {
  assert.deepEqual(
    hoveredLineToAnchor("src/a.ts", { lineNumber: 12, side: "additions" }),
    { path: "src/a.ts", startLine: 12, endLine: 12, targetSide: "new" },
  );
  assert.deepEqual(
    hoveredLineToAnchor("src/a.ts", { lineNumber: 5, side: "deletions" }),
    { path: "src/a.ts", startLine: 5, endLine: 5, targetSide: "old" },
  );
  assert.equal(hoveredLineToAnchor("src/a.ts", undefined), null);
});
```

The existing `selectionRangeToAnchor(...)` tests should stay and continue to cover drag-based range creation.

---

## Task 4: Cleanup details while implementing A/B/C

**Files:**
- Modify as needed: `pi-extension/diff-review/web/src/App.tsx`
- Modify as needed: `pi-extension/diff-review/web/src/state/review-session.ts`
- Modify as needed: `pi-extension/diff-review/web/src/ui.ts`

### Exact cleanup goals

- Keep Pierre-specific translation in adapter/helper files, not in `App.tsx`.
- Avoid duplicating anchor-formatting and annotation-building logic across components.
- Keep sidebar focus state browser-local and non-persistent.
- If `CommentThread.tsx` grows too large after adding focus/scrolling behavior, split a tiny helper like `thread-focus.ts` or move timeline formatting into `ui.ts`.

---

## Verification plan

### Targeted commands during development

Run after each task:

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
node --test test/extensions/diff-review-web-smoke.test.mjs
```

### Full verification before completion

```bash
cd /home/ashalom/Github/pi-agent-stuff/.worktrees/diff-review-web
npm run build:diff-review-web
npm run verify:diff-review-web
npm test
```

Expected:
- build succeeds
- static verification succeeds
- full test suite passes

## Expected code simplification outcome

After this plan lands:

- the tree should no longer rely on `key={createRepoTreeModelKey(...)}` remounting
- inline diff markers should be rendered by Pierre annotations instead of custom overlay code
- single-line comment affordance should use Pierre gutter utilities instead of bespoke click-target logic
- `App.tsx` should only orchestrate app state, not translate Pierre-specific event models

# Diff-review rollback log — 2026-05-20

## Status
The attempted fixes in this session were **not successful**.

They did **not** fix either of the two browser-reproduced bugs:

1. **Repo tree collapse bug**
   - Repro still occurred: collapse one folder, select a file in a different folder, and the originally collapsed folder re-expanded.
2. **Reply bug**
   - Repro still occurred: clicking **Reply** and submitting still created a **new thread**.
   - Confirming signal from browser network inspection: the UI still hit `POST /api/threads?...` instead of `POST /api/threads/:threadId/replies`.

## Conceptual changes attempted before rollback

### Tree / Pierre integration attempts
- Split Pierre tree syncing into separate path-sync and git-status-sync steps.
- Removed routine reveal / focus calls during tree sync so Pierre, not app code, would own expansion state.
- Tried to preserve selected file even when hidden by the changed-only filter.
- Ignored directory selections from Pierre when syncing selected files back into app state.
- Later tried explicit Pierre selection syncing without focus / reveal to clear stale hidden selection.
- Added temporary tree debug logging around selection changes, model updates, and Pierre mutation events.

### Reply / draft-flow attempts
- Protected active reply drafts from being overwritten by later line/file draft creation.
- Added `replyTargetThreadId` so reply intent could survive if a reply draft moved into the generic thread-style composer.
- Changed save logic so a thread-style draft with `replyTargetThreadId` would call the reply endpoint instead of the new-thread endpoint.
- Changed generic composer labels/titles to reflect reply context (`Reply`, `Submit reply`) instead of always implying new-thread creation.
- Added temporary API / draft / selection debug logging.
- Later tried suppressing diff-selection callback echoes from Pierre diffs so controlled selection would not convert a reply back into a generic thread draft.
- Later tightened that suppression to ignore selection echoes while reply drafts were active, using refs to avoid stale render closures.

## Result
Despite the above, the browser repros still failed for **both** bugs.

Because the code path had become more complicated without solving the actual issues, the experimental bug-fix changes from this session were rolled back.

## Rollback scope
Rolled back the experimental browser-side/tree/reply changes in the diff-review web app and related smoke/state tests, plus rebuilt static assets that reflected those experiments.

## Intentionally retained
An unrelated prompt-contract improvement was **not** part of this rollback:
- the diff-review prompt change that explicitly allows requested code edits during review replies and requires reporting those edits back.

That prompt change was retained because it is conceptually separate from the two unresolved browser bugs.

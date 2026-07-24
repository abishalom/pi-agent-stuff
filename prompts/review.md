---
description: Run parallel standards and requirements reviews in one Hunk session
argument-hint: "[spec path or review instructions]"
---
Review the current uncommitted working tree along two independent axes by launching exactly two `reviewer` subagents.

Additional user context: ${ARGUMENTS:-none supplied}

## Preflight — do not launch reviewers yet

1. Establish the review scope once with `git status --short`, unstaged and staged diffs, and direct inspection of relevant untracked files. If there are no changes, report that and stop.
2. Auto-discover the repository's written coding standards, including applicable `AGENTS.md`, `CONTRIBUTING*`, `CODING_STANDARDS*`, `STYLE*`, and relevant README or documentation files. Distinguish documented rules from checks already enforced by tooling. If no standards source exists, or the applicable sources conflict, ask the user what to use and stop until answered. If the user confirms there are no written standards, proceed with the maintainability heuristics below and label them as judgement calls.
3. Identify the requirements source from the supplied arguments, the current conversation/task, and relevant issue, plan, spec, or design files. If no meaningful requirements source can be established, ask the user for one—or explicit confirmation that there is no written spec—and stop until answered. If the user confirms there is no written spec, use their stated intent and clearly label inferred behavioral expectations.
4. Resolve and follow the installed Hunk guidance from `hunk skill path`. Ensure exactly one shared Hunk session exists for this repository before launching either reviewer. Reuse `hunk session get --repo . --json` when available; inspect its source and ask before replacing a non-working-tree review or disturbing existing user context. Otherwise create a background tab with `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label "Hunk review" --no-focus`, parse its root pane ID, run `herdr pane run <pane-id> "hunk diff --watch"`, and wait briefly until `hunk session get --repo . --json` succeeds. Read existing user comments before dispatch.

## Dispatch

Launch both children before waiting for either to finish. Use two separate `subagent` calls with `agent: "reviewer"`, default tab placement, and distinct names. Preserve the same review scope in both tasks, but do not give either child the other axis's analysis.

### Standards reviewer

Name it `Standards review`. Give it:

- the exact working-tree scope and discovered standards-source paths;
- the instruction to report documented-standard violations with citations;
- the instruction to identify maintainability concerns as judgement calls, including possible mysterious naming, duplication, feature envy, data clumps, primitive obsession, repeated branching, shotgun surgery, divergent responsibilities, speculative generality, message chains, needless middlemen, or misused inheritance;
- the rule that repository standards override generic heuristics and tooling-enforced issues should be skipped;
- the shared Hunk repository session, with every inline summary prefixed `[Standards]`.

### Requirements reviewer

Name it `Requirements review`. Give it:

- the exact same working-tree scope and the identified requirements source;
- the instruction to find missing or partial requirements, incorrect implementations, unintended behavior or scope creep, regressions, and missing validation;
- the instruction to cite the relevant requirement for every spec-conformance finding and clearly distinguish inferred correctness concerns;
- the shared Hunk repository session, with every inline summary prefixed `[Requirements]`.

Both tasks must require actionable findings only, file and line references, no code changes, and a final response even when there are no findings. Both reviewers must read user-authored Hunk comments before reviewing and again before finishing.

## Completion and aggregation

Keep both returned pane IDs. Child completion is asynchronous: do not poll or repeatedly wait. When completion follow-ups arrive, call `get_subagent_result` at most once for each unfinished child. If either is still working or blocked, give only a brief status update and wait for a later completion event.

After both complete:

1. Confirm their actionable findings are present as tagged comments in the same Hunk session; add any omitted finding to Hunk before reporting.
2. Present the reports separately under `## Standards` and `## Requirements`. Lightly clean wording, but do not merge or rerank findings across axes.
3. End with counts and the highest-severity finding within each axis, without choosing one overall winner.

Do not launch workers or apply fixes as part of `/review`. Leave both reviewer sessions and the shared Hunk session open for user interaction and follow-ups.

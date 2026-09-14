---
name: build-in-public
description: Turn repository documentation, recent changes, tests, and visual artifacts into evidence-backed build-in-public social content. Use when asked to find product stories in a codebase, prepare a content bank, draft posts, or refresh public progress updates from project work.
---

# Build in Public

Create useful, credible social content from work that actually happened in the
repository. Treat the repository as the source of truth and separate released
results, work in progress, plans, and unresolved questions.

## Default deliverable

Unless the user asks for a different format, produce a dated Markdown content
pack containing:

1. a short current product narrative;
2. an evidence ledger with source files;
3. 8–15 ranked post angles;
4. 3–6 ready-to-edit posts in the user's language;
5. suggested screenshots, clips, diagrams, or code excerpts for each post;
6. claims that need confirmation before publication;
7. the next repository changes likely to yield good follow-up posts.

Save the pack near this skill when it belongs to this repository. Use a path the
user supplied when they gave one. Do not publish or schedule posts unless the
user explicitly asks for that external action.

## Evidence workflow

### 1. Establish the repository state

- Find repository instructions and read the relevant `AGENTS.md` files first.
- Inspect `git status`, the recent dated commit log, and the Markdown inventory.
- Read the product overview, handoffs, specifications, test notes, deployment
  notes, and use-case documents that can explain user value or a development
  decision.
- Inspect recent diffs when the working tree contains relevant changes. Do not
  describe uncommitted work as released.
- Inventory checked-in images, videos, fixtures, demos, and debug pages that can
  supply proof or visuals. Exclude dependencies and build output unless needed.

Start broad with `rg --files` and heading searches, then read the promising
documents in full. Prefer `rg` and `git` over manually walking directories.

### 2. Build an evidence ledger

For every candidate claim, record:

| Field | Meaning |
|---|---|
| Claim | One concrete statement a post may make |
| Status | `released`, `implemented`, `verified`, `in progress`, `planned`, or `unknown` |
| Evidence | File and line, commit, test output, or device result |
| User value | Why a non-author should care |
| Visual | Existing or proposed proof artifact |
| Caveat | Limit, uncertainty, or environment boundary |

Resolve contradictions using this order:

1. current code and current test output;
2. newer dated implementation or handoff notes;
3. recent commits;
4. older plans and specifications.

A plan is evidence of intent, never evidence that a feature shipped. A passing
headless GPU check is evidence of correctness in that environment, not proof of
performance on physical hardware. Preserve useful qualifications in the post
instead of inflating the claim.

### 3. Find stories, not changelog entries

Prioritize angles with a visible consequence, a surprising cause, or a reusable
lesson. Strong recurring shapes are:

- symptom → investigation → root cause → fix → proof;
- constraint → rejected option → tradeoff → result;
- extraction → second consumer → hidden coupling found;
- visual mismatch → measured contract → parity restored;
- assumption → physical-device result → design changed;
- raw capability → public API → new use case;
- test that passed → deliberate sabotage → test earned trust;
- current limitation → concrete next experiment.

Translate implementation detail into product meaning. Keep one technical anchor
such as `NEAREST`, RYB, DPR, or a named API when it makes the story memorable,
then explain it in plain language.

Rank candidates by:

`story score = user impact + surprise + strength of proof + visual potential + timeliness`

Use a simple 1–5 judgment for each factor. Prefer recent work, but keep older
stories when the lesson is unusually strong or supports a series.

### 4. Draft from the evidence

Each post should contain:

- a concrete opening line;
- the problem or goal in language a product user understands;
- one or two implementation details that explain the difficulty;
- proof: a test count, measured result, device check, demo, or before/after;
- what changed for the product;
- a natural question or invitation when discussion would be useful;
- `#buildinpublic` plus only a few relevant tags.

Avoid generic startup motivation, invented user numbers, unsupported speed
claims, and long file lists. Do not claim that a test proves more than it does.
Do not expose secrets, tokens, private paths, private customer data, or internal
identifiers that do not help the story.

### 5. Adapt to the channel

When no platform is specified, create one reusable master draft and variants for:

- X: concise, one idea, usually under 260 characters before tags; use a thread
  only when the causal chain matters;
- Threads: conversational, compact, room for one technical detail;
- LinkedIn: 700–1,300 characters, short paragraphs, evidence and lesson;
- Mastodon: self-contained and accessible; include useful alt text for media.

Preserve the same factual claim across variants. Adapt length and rhythm, not the
underlying result.

## Visual proof

Prefer proof that a viewer understands without repository context:

1. 5–15 second before/after or playback clip;
2. side-by-side screenshots with the same canvas and input;
3. a crop of a diagnostic or test result with one annotation;
4. a small architecture diagram;
5. a short code excerpt only when the code itself is the insight.

For every proposed asset, write a capture recipe and alt text. Clearly label an
asset as `existing`, `can capture now`, or `needs implementation`. Never imply
that a proposed mockup or planned UI already exists.

## Refresh mode

When rerunning this skill after more work:

1. read the previous content pack if one exists;
2. compare its evidence boundary with the current git log and working tree;
3. add only new or materially changed stories;
4. update statuses whose evidence changed;
5. avoid repeating the same hook unless the new post is an explicit follow-up;
6. retain a short list of used angles so the series develops over time.

For this repository, the initial researched pack is
[`POST-MATERIALS-2026-09-09.md`](POST-MATERIALS-2026-09-09.md). Treat it as
editorial memory, then verify its claims against the current repository before
reusing them.

---
name: handoff
description: Runs work in phases with a context clear between them — reads handoff.md at the start of a phase, implements, runs the eval, writes QA scenarios for manual checking, hands the phase over for human review, updates the handoff and commits. Invoke to inspect a phase ("handoff:start", "read handoff"), to start or resume work ("handoff:continue", "continue the work", "продовж роботу", "next phase", "наступна фаза"), at the end ("handoff:next", "write the handoff", "запиши handoff", "close the phase", "закрий фазу") and on any "handoff:*" code. One phase = one context.
---

# Handoff — working in phases

Long work is split into phases. Each phase lives in a **clean context**:
everything that has to survive `/clear` is in `handoff.md`, not in the
session's memory.

## The cycle

1. `/clear`
2. read `handoff.md`
3. implement
4. eval (tests, probe, measurements)
5. QA documentation (what to open, what to click, what should happen)
6. human review
7. update `handoff.md` + commit
8. → 1

## Codes

A phase is driven by short `handoff:*` codes. A digit means a step of the
cycle, a word means an action on the phase. A code in the user's message is
carried out at once, without asking "are you sure".

### Digits — back to a step in the same phase

Digits mostly come from the autonomous controller `handoff-run` (it sends
`handoff:5` itself); a person drives the phase with words. Accept both
sources the same way.

| code | what to do |
|---|---|
| `handoff:3` | review failed: go back to implementation. The text that follows says what is wrong |
| `handoff:4` | rerun the eval and give fresh numbers |
| `handoff:5` | rewrite or complete `QA.md` |

`handoff:2` does not exist: step 2 is reading in a **clean** context. The
entry into a phase is `handoff:start` (read only) or `handoff:continue`
(read and execute).

### Words — actions on the phase

| code | what to do |
|---|---|
| `handoff:start [topic]` | read `HANDOFF.md` and say where you start. **Do nothing else** |
| `handoff:continue [topic]` | resume the unfinished phase, otherwise start the unambiguous next phase from `HANDOFF.md`, without asking for permission to work |
| `handoff:next` | all OK: step 7 — update `HANDOFF.md`, commit, ask for `/clear` |
| `handoff:qa <code> <what is wrong>` | a QA scenario failed: `handoff:qa A5 diagnostics empty` |
| `handoff:hold` | stop, do not commit: the user is still looking |
| `handoff:split` | the context is running out: close the phase narrower than planned and record it as it is. Narrower is better than reaching context summarization with unrecorded state |

### `handoff:start`

The argument is a topic, not an engine: `handoff:start three`,
`handoff:start fluid`. Find the topic's `HANDOFF.md` in this repository's
[registry](#topic-registry) (`AGENTS.md`) and read it **in full**. If the
topic is not in the registry, search the repository for `HANDOFF.md`; with no
argument take the only one, and if there are several, ask which — do not
guess.

If the topic's `HANDOFF.md` is **not found at all** but there is a spec
(`*-SPEC.md`), that is the entry to the
[spec-to-handoff reminder](#spec-to-handoff-reminder), not a reason to
reconstruct the phases yourself.

Reply: the state of the phase, where I start, what is open. **No code
changes** — this is the entry into the phase, not its execution. Then wait
for permission to start.

For a cross-repository topic add a line to the reply: which of the open items
live on our side and which on the other. See
[cross-repository topics](#cross-repository-topics).

If `HANDOFF.md` is found, count the struck-through (`^~~<number>.`) phases
at the same time — see the [archiving reminder](#archiving-reminder).

### `handoff:continue`

This is permission to work immediately, including after a failure, a usage
limit or another interruption. Do not ask for permission to start or resume.

Use the named topic, otherwise the topic already established in this
session. If neither is available, resolve the topic and its `HANDOFF.md`
as on `handoff:start`; read the file **in full**. Read it again on resumption
too: session memory is not a substitute for the written state.

- **An unfinished phase exists:** resume that phase from the first unfinished
  step. Reconcile `HANDOFF.md` with the existing worktree and available
  results of the interrupted attempt. Keep partial work; do not restart
  completed steps or move to the next phase merely because the session
  stopped. Recheck results when changes or missing evidence require it.
- **No unfinished phase exists:** start the next phase only when
  `HANDOFF.md` identifies it unambiguously (the `Next` / `Далі` marker and
  open items agree). Briefly say which phase you are starting and proceed
  to implementation, eval and QA in the same turn.
- **The phase cannot be determined:** say that the next phase is not
  defined unambiguously, state what is missing or conflicting, and ask the
  person to select or confirm the phase. Do not invent a phase plan. If the
  handoff explicitly says all phases are complete, report completion.

Continue only this phase, then stop for human review as usual.
`handoff:continue` does not approve QA or authorize a commit: a phase already
awaiting review still needs `handoff:next` to close. If closing was interrupted
after an explicit `handoff:next`, that permission remains valid; finish the
remaining closing steps without asking again. An unresolved blocker still
needs a decision, but an interruption alone is not a reason to ask again.

This is the manual skill command, not the controller's `--continue` flag;
it does not launch `handoff-run`.

### `handoff:next`

`handoff:next` **is** the direct request to commit — do not ask again: the
repository rule "do not commit unless asked" is satisfied by it.

In order:

1. Update `HANDOFF.md`: remove notes like "the owner has not run QA",
   update the phase log in `QA.md`, strike through the closed items.
2. Commit. No `Co-Authored-By`. If the changes form several meaningful
   groups, split them into commits rather than piling them into one.
3. Say what is done and end the reply with the `/clear` block — see
   ["The command at the end of the report"](#the-command-at-the-end-of-the-report).

After the update, the same check as on `handoff:start`: whether the number of
struck-through phases has just crossed the threshold.

### Reminders about neighbouring skills

`handoff-archive` and `spec-to-handoff` are separate skills, and **the agent
never runs them itself**. Reminders about them live exactly on
`handoff:start` and `handoff:next` — the file is open there anyway — **and
nowhere else**: do not walk the repository looking for a reason to remind.

### spec-to-handoff reminder

Arises only on `handoff:start`, when the topic's `HANDOFF.md` is **not
found**. Is there a `*-SPEC.md` without a phase plan in the same directory
(`intend.md` does not count — it is a notebook of intent, not a spec)? If
there is, one sentence at the end of the reply, in the report language: "this
spec has no phase plan yet; `spec-to-handoff <topic>` can make one", then the
usual behaviour for a topic without HANDOFF.md (nothing to start from, wait
for the person's decision). No spec — say nothing.

### Archiving reminder

Arises on `handoff:start` (just read) and on `handoff:next` (just updated),
when `HANDOFF.md` is found. Count the struck-through items of both files by
the **start of the item**, `^~~<number>.`, not by a whole
`~~...~~ — ЗАКРИТО` / `~~...~~ — CLOSED`: the strike-through and the closed
marker are almost always split by a line break, so the whole pattern gives 0
on a real file.

If there are **more than 3**, or the file itself had to be read in parts
because of its size, add one sentence at the end of the reply, in the report
language: "the `HANDOFF.md` of topic `<topic>` already has N closed phases;
`handoff-archive <topic>` can archive them" — and continue the step (start or
next) as usual, without waiting for a reaction to that sentence. Below the
threshold say nothing; do not report "no archiving needed".

## At the start of a phase (steps 2-3)

Read `handoff.md` in full, not diagonally. After that, only the files it
names. Do not reconstruct the picture by walking the tree.

If the handoff does not name the next step unambiguously, ask — do not guess.

## Eval (step 4)

Run what the handoff or the spec names as the phase's check.

**A full run is not proof.** `npx vitest run` is the `full` level: it is
cheap but blind to what a person sees on screen. Three regressions passed
through a green 1871 passed (`three`, 2026-09-19). A whole run is not a reason
to close a phase and not where to start.

But **while working**, `full` is the main feedback together with guard: it is
an order of magnitude cheaper than a probe and catches what a refactoring
breaks. Compare your own two numbers and use the cheaper one. A probe answers
another question — "does it work by hand" — and is run once, when the seams
are in place.

If the topic has an `INVARIANTS.md`, it names the levels and what fails on
each:

| level | when | what |
|---|---|---|
| **guard** | before every commit | static bans + invariant unit tests |
| **probe** | before `handoff:next` | browser probe — an interaction a unit test does not see |
| **full** | before merge / on request | everything, including the inventory |

**Only guard** has the right to fail and block. A phase is closed by guard +
probe.

The agent takes each level's command from the topic registry or the topic's
`INVARIANTS.md`; it does not guess. The order is fixed: guard, then the probe,
then the full run if needed.

If the answer to "why were the checks silent" is "the test measured the same
thing as the code" or "the mock replaced the calling convention", the right
action is to **fix the fixture**, not to add a guard rule.

**A test that breaks on a legal config change is a defect of the test, not of
the code.** Do not repair the list — rewrite it as an invariant ("enabled in
the config ⟺ present in the DOM"). Otherwise every phase pays for someone
else's inventory.

In the report — actual passed/failed, **per level**, not as one number. The
test count from an old handoff is not a current result. Mark independent
failures that existed before the phase as such.

### A phase that fixed a regression adds an invariant

A topic with an invariant registry is not closed without a record if the
phase fixed a regression. **Where exactly is decided by the topic registry's
gate, not by this skill**: a platform rule, a subsystem's domain contract and
one phase's decision may live in different files. Read the registry's gate
before writing.

**Saying "this is a phase decision, not an invariant" is a correct result,
not a refusal.** The phase must classify the regression, not necessarily add
an invariant.

An invariant is: the statement, its origin (which incident and when), the
mechanism, a checkable assertion, where it lives. A static rule also goes
into the topic's guard.

That is how experience accumulates by itself rather than because someone
remembered. An invariant without an origin in an incident is a wish, not an
invariant. **A rule without a named mutation of the real source that fails a
specific check does not go into the registry** — how it is proven is said by
the topic's registry.

## QA documentation (step 5)

Automated tests say "green" but do not say **what a person will see**.
Manual scenarios are what the owner checks the phase by, with their own eyes.

The file is `QA.md` next to the phase's code. It is a cumulative log in
reverse chronological order: insert the new phase section at the top, right
after the heading and the unchanging preamble (run/deploy instructions, if
any), not at the end. Scenarios of earlier phases stay below and must keep
passing.

### Scenario format

There is **one** format — the machine keys `qa:*`, for both manual and
autonomous checking. Four fields, all four required in every scenario:

| key | how to write it |
|---|---|
| `**qa:open:**` | the full URL with parameters, not "the stand". For a CLI — the terminal and the directory |
| `**qa:action:**` | the concrete element in clicking order, or the exact command |
| `**qa:inspect:**` | where exactly to look — panel, counter, area of the scene, output stream |
| `**qa:expected:**` | what is visible, with a number or exact text |

The text after a key is in the document language (see
[Document language](#document-language)); the key is not — it is a machine
key.

```markdown
### QA-A3. An unknown parameter does not break the page

**qa:mode:** browser
**qa:open:** `http://127.0.0.1:8080/viewer/engines/three/?camera=nonsuch`
**qa:action:** nothing.
**qa:inspect:** the scene + the browser console.
**qa:expected:** the scene loads in isometric view (the default),
the console shows the warning `Unknown value camera=nonsuch`, no errors.
```

Rules that fail an autonomous run if broken:

- **The phase section heading contains its ID.** `## V8. Operator skill`
  for phase `V8`. Without the ID the controller stops the phase
  (`QA section heading must identify phase <id>`), because it cannot find
  the section.
- **A scenario ID is unique across the whole file.** `QA-A1` in two phases
  is a parse error for the whole section, not a trifle: the log is
  cumulative, so numbering by phase (`QA-A1`, `QA-B1`) is how to avoid a
  collision.
- **`qa:mode:` is `cli` or `browser`, at most once.** It does not exempt
  from any of the four fields: a CLI scenario has `qa:open:` too (terminal,
  directory, environment variables), just without a URL. Without `qa:mode:`
  the mode is guessed from `qa:open:` — stating it is more reliable.
- **`qa:inspect:` and `qa:expected:` are never empty.** For a browser
  scenario an empty field is `QA_UNEXECUTABLE: … has no bounded visual criteria`.

The old field names (**Відкрити**, **Клікнути**, **Дивитись**,
**Очікуваний результат** and the English
`Open`/`Action`/`Inspect`/`Expected Result`) are still read by the parser so
as not to break existing files. Do not write them
in a new scenario, and do not rewrite existing ones in passing — only if the
phase touches them anyway.

### Evidence in an autonomous `handoff-run`

Take the directory **from the controller's message** (an absolute path under
`<repoRoot>/.agentic-loop/qa/<feature>/<phase>/` — a pattern to check
against, not a path to compose yourself). Check it against the repository
root and the current phase before the first command or screenshot; the
working directory of the shell or Playwright does not change where things are
written. Everything — JSON, stdout, stderr, exit codes, screenshots, logs —
goes only inside that directory (for a CLI, stdout, stderr and the exit code
are required; for a browser, real screenshots); in the report, paths relative
to the repository root.

**Do not create a parallel `qa-evidence/`** — not for QA, not for the phase
eval, not with `.gitignore` as a way to hide the records. If the eval needs
files, use a tool's ignored directory or a temporary directory outside the
repository; the phase commit keeps only product and documentation files. If
the given directory is unavailable, do not redirect the evidence: mark the
scenarios `unexecutable` with `failureKind: environment` and state the access
error.

Rules:

- **One scenario — one check.** Do not stitch five clicks into one item.
- **The expected result is checkable.** "Looks good" is not a result;
  "3 draw calls", "4 layers in the list", "a yellow diagnostics row" are.
- **The expected result is a steady state.** The snapshot is taken seconds
  later, not at the moment of the click: QA does not freeze animations and
  timers, so a scenario with only an instantaneous state will honestly fail.
  Describe an intermediate state as a sequence: "the status first reads
  `forward`, a moment later `flying to …`".
- **Every step is executed before review.** Run every console command, URL
  and selector of the new scenarios yourself (in the eval, `.pw-probe` or a
  browser) before handing `QA.md` over for review. A module that does not
  resolve, or a hook that does not exist in the code, is a defect of the
  scenario or the stand; the author finds it, not QA. If a check lacks a test
  hook or a debug API, build it in this phase rather than describing a
  workaround.
- **Stop a server started for checking before the end of the turn.** Every
  dev server or other process the agent itself started for the eval or for
  running the steps is stopped before the phase is handed over for review,
  and likewise after the commit. Check that the port is free. Do not touch a
  process you did not start. The autonomous controller starts its own QA
  service on the same port. If something answers there after the turn, the
  controller stops with `PHASE_LEFT_SERVICE_RUNNING`.
- **Mark what a probe covers.** If a scenario is already checked by
  `.pw-probe`, say so — the person looks with their eyes at what an automaton
  cannot check (proportions, z-fighting, the direction of Y, flicker).
- **First — how to run it locally.** Server, port, address, whether internet
  is needed. Without this the document is unusable.
- What is broken or not implemented yet goes in a separate section, so the
  person does not look for a bug where it was left deliberately.

### Auto-deploy after QA.md

Right after the `QA.md` heading, check for a deploy line — the deploy marker
from [Anchors](#anchors) at the start of a line, `**Деплой:** ...` or
`**Deploy:** ...`. If it is there, run the command literally, without edits
and without reading `DEPLOY.md` for explanations: the line is self-contained,
it is a ready shell command.

```markdown
**Deploy:** `<ready shell command that builds and deploys this topic>`
```

No line — do not deploy and do not ask about it: the absence of the marker
means deployment is not set up for this topic or not needed every phase. Do
not guess the command from `DEPLOY.md` or a Gulpfile yourself.

Deploy before step 6 (human review): the owner should see the ready stand in
the review report, not wait for it separately.

## Human review (step 6)

Report and **stop**. Do not commit until the person gives the go-ahead.
Show what was done, what was measured, what is still open, and give a link
to `QA.md` — from there the person checks.

### The command at the end of the report

`/context` and `/clear` are built-in CLI commands: the harness runs them, the
agent cannot call them. So a phase ends not with a description but with a
**ready block to copy**.

The review report ends with exactly this — a separate code block, with no
text inside:

```
/context
handoff:next
```

After the commit (step 7) — likewise:

```
/clear
handoff:start <topic>
```

Rules of the block:

- The code block on its own, so the copy button works; one command, nothing
  next to it.
- **Last in the reply**, so that on a phone there is no need to scroll up.
- No "please press it if you don't mind" — the command speaks for itself.
- **No commentary.** Not why `/context`, not what comes next, not estimates
  of remaining context. The block comes without accompanying text.

The user's answer comes as a code: `handoff:next` — all OK, close the phase;
`handoff:3` or `handoff:qa <code>` — back to work; `handoff:hold` — stop.

## Writing the handoff (step 7)

`handoff.md` is the input for an agent with zero context. It must answer:
what already works, what is broken, what to do next and why exactly so.

Structure (shown with the English markers; a topic writes the forms of its
document language from [Anchors](#anchors)):

```markdown
# Handoff: <topic>

State as of <date>. <branch / what is committed and what is not>.

> **Next:** <the next file or phase>

## What works
<table file | state>

## Measured facts
<numbers, not impressions; keep refuted hypotheses explicitly>

## OPEN — start here
<numbered items; strike closed ones through, do not delete them>
```

Rules:

- **Numbers, not adjectives.** "7 fps on 47k tiles", not "slow".
- **Keep refuted hypotheses.** Otherwise the next agent will check them again.
- **Strike closed items through** (`~~1. ...~~ — CLOSED`, or the topic
  language's form from [Anchors](#anchors)), do not erase them: visible
  history.
- Do not retell what is already in the spec — refer to it (`SPEC.md §7`).
- Language — by the [document language rule](#document-language).

Commit only after the person's go-ahead (`handoff:next`), without
`Co-Authored-By`.

## Document language

The skills are written in English; the documents they write are not
necessarily. This rule is stated here once — the other handoff skills refer
to it and do not repeat it.

**The document language** (a topic's `HANDOFF.md`, `QA.md` and
`_archive/*`; a repository's `INVARIANTS.md`/`DECISIONS.md`) is decided by
the first rule that applies:

1. **An existing file** — the language of its prose. For a topic's documents
   that is the language of the topic's `HANDOFF.md`; for a repository-level
   file (`INVARIANTS.md`, `DECISIONS.md`) — the language of the file itself.
   This beats the repository setting: appending never changes a file's
   language.
2. **The repository setting** — `AGENTS.md` → section `## Language`, line
   `docs: <code>` (BCP 47: `uk`, `en`, `de`).
3. **The language of the person's request** that creates the document
   (`spec-to-handoff <topic>`, `invariant-guard:bootstrap`).

There is no autonomous case for a new document: a topic is created only by
`spec-to-handoff` and an invariant registry only by `invariant-guard`, both
run only on a person's direct command. When `handoff-run` starts, the
topic's `HANDOFF.md` already exists, so rule 1 applies.

**The report language** (what you tell the person): the repository setting
`AGENTS.md` → section `## Language`, line `reports: <code>`, when it is there;
otherwise in an interactive session — the language of the person's last
message; in an autonomous run — the topic's document language.

Mixing:

- A topic's `QA.md` is always in the same language as the topic's
  `HANDOFF.md`.
- Existing sections are never translated as a side effect. Moving a topic to
  another language happens only on the person's explicit command.
- Code, identifiers and commits are unchanged (English).
- **Markers** are not prose: write the form of the document language from
  [Anchors](#anchors). For a language the table lacks, write the English
  markers and the prose in the document language. **Never invent a
  translated marker** — the controller and the skills read only the forms in
  the table, so a made-up one (a Latvian `**Izvietošana:**` for the deploy
  line) is silently not seen and switches the check off.

## Anchors

The fixed markers of `HANDOFF.md`, `QA.md` and `AGENTS.md`. An agent
**writes** the form of the document language; the skills and the controller
**read** any form in this table, so a Ukrainian topic keeps `Далі` and
`НЕЗАКРИТЕ` while an English one has `Next` and `OPEN`. A marker word is
matched as a whole word. The controller keeps the same table as a constant
(`DOCUMENT_ANCHORS`), and a test holds the two equal — change both together.

| role | `uk` | `en` |
|---|---|---|
| current phase | `> **Далі:**` | `> **Next:**` |
| section of open items | `## НЕЗАКРИТЕ — почни звідси` | `## OPEN — start here` |
| closed item | `~~N. …~~ — ЗАКРИТО` | `~~N. …~~ — CLOSED` |
| what works | `## Що зроблено і працює` | `## What works` |
| measured facts | `## Головні виміряні факти` | `## Measured facts` |
| deliberately not done (QA) | `### Свідомо не зроблено в <phase>` | `### Deliberately not done in <phase>` |
| deploy in `QA.md` | `**Деплой:**` | `**Deploy:**` |
| topic registry in `AGENTS.md` | `## Реєстр тем` | `## Topic registry` |

## Where the documents live

The usual place is next to the phase's code, not the repository root.
`HANDOFF.md` is for the agent, `QA.md` for the person, `README.md` for how to
run it.

When a file has grown, archiving is done by the separate skill
`handoff-archive`, which puts paired `_archive/HANDOFF-phases-<X>-<Y>.md` +
`_archive/QA-phases-<X>-<Y>.md`. Dated continuations next to the live file
(`HANDOFF-2026-09-07.md`) are the old form: do not touch existing ones, do
not name new ones so.

The exception is cross-repository topics: there "next to the code" does not
exist, because the code is scattered. The documents live in
`docs/spec/<topic>/`.

### Topic registry

The topic registry is **in the repository**, not here: the topic registry
section of its `AGENTS.md` (either form from [Anchors](#anchors)).

Row format — `topic | HANDOFF.md | code | invariants`.

No `AGENTS.md`, or no registry in it — find `HANDOFF.md` by search (see
[`handoff:start`](#handoffstart)), and add the row at the same time the
topic's `HANDOFF.md` is created.

## Cross-repository topics

A topic is cross-repository when part of its code lives in another
repository and the spec is not next to the code. The phase cycle is the
same; four things change.

**1. The handoff starts with a map, not with the state.** Right after the
heading — a table "what / where / which repository", and separately a list
of vendored files: the canonical copy here, the second copy there; editing
one side without the other breaks the link.

**2. Every open item has a side.** The first thing a phase does with an item
is decide which side it lives on. An item of the other side is **not fixed**
by this phase: it describes it as a contract and checks it on the deployed
stand. Do not spend the phase looking for code that is not in this
repository.

**3. The eval has two parts.** Our tests (`npx vitest run`) only say that
the contract is intact on our side. That the link actually works is shown
only by a run on the pair of stands. In the report keep these two numbers
apart, do not mix them.

**4. Stand addresses go stale.** Draft deploys change URLs. Do not write
them into `HANDOFF.md` as a fact — refer to the file where they are kept
up to date (for `fluid` it is `fluid-paint-vendor-manifest.md`).

In a cross-repository topic's `QA.md` the scenarios are grouped by side:
first those that check the external application directly, then the link
through ours. The person must see from the scenario number which repository
to look for the bug in.

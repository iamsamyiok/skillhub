---
name: handoff
version: 1.0.0
category: 工作流
tags: [交接, handoff, Claude Code, Codex, HANDOFF.md, AI协作]
description: Hand off the current work to another AI coding tool (Codex), or resume work that another tool handed off, via a structured HANDOFF.md document in the project root. Use when the user wants to switch between Claude Code and Codex mid-task, "hand off", "交接", "save progress for the other tool", "pick up / resume / 接续 where the other tool left off", or run `/handoff save` or `/handoff resume`.
license: MIT
tools: Read, Write, Bash
---

# Handoff (Claude Code ↔ Codex)

Carry work progress between Claude Code and Codex through one shared, human-readable
`HANDOFF.md` file at the **project root**. This skill only reads and writes that document —
it never launches the other CLI.

This Claude Code instance writes `tool: claude-code` when it saves.

## Modes

Read the argument after `/handoff`:

- `save` (aliases: `out`, `保存`, `交接`) → **Save** the current work into `HANDOFF.md`.
- `resume` (aliases: `in`, `接续`, `恢复`) → **Resume** from an existing `HANDOFF.md`.
- *(no argument)* → Auto-detect: if `HANDOFF.md` exists and its `tool:` header is **not**
  `claude-code`, do **resume**; otherwise do **save**. State which mode you picked and why.

An explicit argument always wins over auto-detect.

The document lives at `<cwd>/HANDOFF.md` by default. If the user names a different path, use that.

---

## Save

1. **Reconstruct the work.** From this session, identify: the goal, what was done, key decisions,
   what works vs. what's still broken/partial, the concrete next steps, the relevant files, open
   questions, and how to verify.
2. **Ground it in git** (best-effort; skip cleanly if not a repo). Run:
   - `git rev-parse --abbrev-ref HEAD` → branch
   - `git rev-parse --short HEAD` → commit
   - `git status --short` and `git diff --stat` → uncommitted changes for "Current state"
   Use real output; never invent a branch/commit.
3. **Write `HANDOFF.md`** to the project root using the template below. Fill every section; if a
   section truly has nothing, write `- (none)` rather than deleting the heading.
4. **Confirm** to the user: report the path written and the status, then print the pickup hint:
   > In Codex, `cd` into this directory and run `/handoff resume` (or `/handoff` to auto-detect).

   Do **not** run `codex` yourself.

---

## Resume

1. **Read `HANDOFF.md`** from the project root. If it is missing, tell the user there is nothing to
   resume and stop (offer `/handoff save` instead).
2. **Reality-check against git** (best-effort): run `git status --short` and `git rev-parse --short HEAD`.
   Compare the actual branch/commit/working tree to the document's header and "Current state".
   **Explicitly flag any drift** (e.g. doc says committed but the tree is dirty, or a different branch).
3. **Summarize** for the user, concisely:
   - who handed off (`tool` / `model` / `timestamp`), the **Goal**, where it stands (**status** +
     **Current state**), and the **Next steps**.
4. **Continue** from the first item under **Next steps**. Pause and confirm with the user before any
   large or destructive action (consistent with this being a deliberate, controlled handoff).

---

## HANDOFF.md template

Keep this format **identical** to the Codex side so either tool can read it.

```markdown
---
tool: claude-code
model: <model name, e.g. claude-opus-4-8>
timestamp: <ISO 8601, e.g. 2026-06-02T14:30:00Z>
cwd: <absolute project path>
git_branch: <branch or "n/a">
git_commit: <short sha or "n/a">
status: in_progress | blocked | done
---

# Handoff: <one-line task title>

## Goal
<what we're ultimately trying to achieve>

## Done so far
- <completed work and key decisions, in order>

## Current state
<what works, what's broken/partial, files touched (paths)>

## Next steps
1. <ordered, concrete, actionable — the receiving tool starts here>

## Key files & references
- `path/to/file` — <why it matters>

## Open questions / gotchas
- <blockers, assumptions, things that bit us>

## How to verify / run
<commands to build/test/run and confirm state>
```

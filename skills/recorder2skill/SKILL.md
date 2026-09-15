---
name: recorder2skill
version: 1.1.0
description: "Turn a live screen recording into a reusable agent skill. Use when the user asks to record a task ('record my screen while I...', 'watch me do this and automate it', 'turn this into a skill') on Windows or Linux. Drives the bundled recorder2skill CLI entirely over shell commands; works in any agent that can run commands and read files."
allowed-tools:
  - Bash(node scripts/recorder-cli.mjs *)
  - read
  - write
---

# recorder2skill — record a task, produce a SKILL.md

Record the user's screen while they perform a task once, then generalize that
single run into a standard Agent Skills file (`SKILL.md`) the agent can reuse.
All state lives under a local data root (`C:\temp\recorder2skill` on Windows,
`~/.recorder2skill` elsewhere; override with `RECORDER2SKILL_DATA_DIR`; the
old `RECORDER_DEMO_DATA_DIR` and an existing legacy default dir still work).

## Prerequisites

The recorder must be set up once (see the repo README: `bash scripts/setup.sh`
or `scripts\setup.ps1`). Verify quickly: `node scripts/recorder-cli.mjs last`
exiting 0 (or a clear "No sessions" error) means the CLI works.

## Flow

1. **Start** — run `node scripts/recorder-cli.mjs start`. The command returns
   only once recording is REALLY live and prints the `sessionId`; tell the
   user a floating control bar appeared and to do the task now.
2. **User works; then stops** — the user clicks Stop on the floating bar (or
   presses Ctrl+Shift+R). Do not poll with other commands meanwhile.
3. **Wait for processing** — run
   `node scripts/recorder-cli.mjs wait-ready 600`. It blocks until the session
   is post-processed (frame extraction, dHash dedupe, timeline bundle) and
   returns a summary JSON. If it times out, the recording is still running —
   ask the user to stop it, then re-run.
4. **Analyze** (see method below) — `timeline` (includes the auto-generated
   `description` — start from it), then `events` (text fields are
   PII-redacted), then — only where events are ambiguous — `frames` +
   viewing the JPEG paths. One recording is enough: `align <id>` returns
   the step skeleton plus a hint. If the user can record the same task a
   second time, run `align <id> <id>`: values that vary across recordings
   are lifted into parameters, so the skill covers the task class instead
   of one run.
5. **Write the skill** — compose the SKILL.md body, save it to a temp file,
   then `node scripts/recorder-cli.mjs save-skill <name> --description "..."
   --body-file <file> [--tools "pattern1,pattern2"]`. The description is
   stored single-line (the Codex CLI / Claude Code parser convention).
   When the recording shows a script or command sequence worth reusing
   verbatim, bundle it: `--script <file>` copies it under `scripts/` and
   lists it in a "Bundled scripts" section (note in the body which
   dependencies the script needs and where to run it from). Report the
   returned path to the user; if the output mentions `similarTo`, tell the
   user an existing skill looks related and let them decide.
6. **Validate** — run `node scripts/skill-doctor.mjs <skillDir>` on the
   generated skill; it must exit 0 (frontmatter, single-line description,
   cross-parser limits, bundled-script syntax).
7. **Clean up (optional)** — once the user confirms the skill, move the
   session out of the active set with
   `node scripts/recorder-cli.mjs archive <sessionId>` (nothing is deleted;
   `sessions --all` still lists it).

## Analyzing a session

All times are `atMs` = milliseconds since recording start.

Captured event types (what `events` returns by default):
`app.activate`, `app.title-change`, `browser.url`, `clipboard.change`,
`terminal.command`, `marker`. Add `--all` (or explicit `--types`) to include
structural lifecycle events. Press `Ctrl+Shift+M` (Windows/Linux) or
`Cmd+Shift+M` (macOS) DURING a recording to drop a marker at an intentional
boundary — markers make step splitting much more reliable. String fields in
`events` output are redacted for structured PII (email/card/SSN/phone);
raw values stay on disk only.

1. `node scripts/recorder-cli.mjs timeline` — the shape: ordered steps with
   app / urls / titles / commands / clipboard counts / markers / frame counts.
   The response also carries `description` (the vendor describer's auto
   generated markdown) — read it FIRST as the initial hypothesis, then verify
   and refine against events.
2. Form a hypothesis about the overall intent from the returned `description`
   plus apps / urls / commands.
3. `node scripts/recorder-cli.mjs events` around anything unclear — clipboard
   text (`textPreview`), exact URLs, the sequence of title changes. Narrow
   with `--from <ms> --to <ms>` windows.
4. `node scripts/recorder-cli.mjs frames` — kept frames only (dHash dedupe).
   View a frame by reading its JPEG path IF you have vision; otherwise rely
   on the event timeline, which is designed to carry the session on its own.
   Budget ~5 frames for a 30-60s session.
5. Cross-correlate signals (clipboard <-> terminal <-> title <-> url) to
   confirm each step. Filter against the intent: drop recorder bracketing
   (focusing the recorder to press Start/Stop), OS dialogs, URL tracking
   params, sub-second focus flickers, off-task detours. Never drop a step
   that feeds a later one (a copy, a lookup, a login).

## Writing the SKILL.md

- Generalize from the ONE recorded run: if the user acted on 3 rows, the
  skill handles every row (N). Keep what is essential; drop window
  positions, timings, and one-off specifics.
- Semantic mapping to native tools (never replay UI clicks): browser pages ->
  fetch/webfetch; local files -> read/write/edit; everything shell-shaped ->
  shell commands for the user's OS (PowerShell on Windows, bash on Linux).
  Only genuine UI-only steps stay as manual instructions.
- Extract genuinely fixed literals (a canonical URL, a repo slug) as
  `{{id}}` tokens referenced from the body; variable targets stay as
  instructions.
- Separate calculation steps (read/derive/decide) from action steps
  (submit/send/create/delete). Actions are the risky surface; keep them
  explicit.
- `description` is the trigger: state what it does AND when to reach for it.
  The body stays imperative and skimmable: When to use, the ordered
  procedure, edge cases (empty collection, missing file, one item failing).
- The skill must do exactly what its description says: no hidden side
  effects, no destructive steps the user would not expect.

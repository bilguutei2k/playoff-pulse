> Archived 2026-05-13. Superseded by root AGENTS.md.
> Retained for historical reference only. Do not load as active project instructions.

# AGENTS.md

## Purpose

This file defines how AI coding agents must work in this repository.

The goal is not maximum autonomy. The goal is controlled, reviewable, iterative progress.

Agents must avoid large, risky, or architectural changes unless the user has explicitly reviewed and approved the plan.

---

## Core Rule

Before making any substantial change, stop and create a feedback loop.

A substantial change includes:

- changing database schema
- changing authentication logic
- changing routing structure
- changing deployment configuration
- installing new packages
- rewriting existing components
- deleting files
- renaming major files or folders
- changing state management
- changing API contracts
- modifying Supabase, Prisma, migrations, or environment logic
- changing payment, login, storage, or user-data behavior
- modifying more than 3 files for one task
- making a change that is hard to reverse

If the change is substantial, do not implement immediately.

First provide:

1. What you want to change
2. Why it is necessary
3. Files likely affected
4. Risks
5. Simpler alternatives
6. Exact approval question for the user

Wait for user approval before proceeding.

---

## Default Working Style

Work in small, reversible diffs.

Prefer:

- editing existing files over creating new architecture
- fixing one issue at a time
- preserving current design language
- preserving current folder structure
- using existing dependencies
- explaining tradeoffs briefly
- asking for confirmation when scope expands

Avoid:

- broad rewrites
- speculative improvements
- unnecessary abstractions
- new packages without justification
- changing unrelated files
- "while I'm here" cleanup
- hidden architecture changes
- silent database/schema changes

---

## Planning Requirement

Before implementation, create a short plan.

The plan must include:

1. Goal
2. Current understanding
3. Files to inspect
4. Proposed implementation steps
5. Risk level: Low / Medium / High
6. Whether user approval is required

Do not edit until the plan is complete.

For low-risk changes, you may proceed after presenting the plan unless the user asked for approval first.

For medium- or high-risk changes, stop and wait.

---

## Risk Levels

### Low Risk

Examples:

- styling tweaks
- small copy changes
- fixing imports
- adding a small component
- fixing a simple TypeScript error
- small UI adjustment in one file

Can proceed after a short plan.

### Medium Risk

Examples:

- modifying multiple components
- changing data flow
- adding a new route
- adding a new API call
- changing form behavior
- changing local state structure

Must present plan and ask for user approval.

### High Risk

Examples:

- database migrations
- authentication changes
- deployment changes
- environment variable changes
- package installation
- deleting files
- major refactor
- changing app architecture
- changing Supabase policies
- changing user data handling

Must stop and wait for explicit approval.

---

## Claude + Codex Iteration Process

This repo uses a two-agent review loop.

Claude is treated as the primary planner/builder.

Codex is treated as the critical reviewer/debugger.

Neither agent has final authority. The user has final authority.

---

## Required Iteration Loop

For any medium- or high-risk task, use this workflow:

### Phase 1 — Claude Planning

Claude should inspect the repo and produce:

1. Problem summary
2. Relevant files
3. Proposed approach
4. Risk level
5. Open questions
6. What Codex should review

No implementation yet.

### Phase 2 — Codex Review of Plan

Codex should review Claude's plan and respond with:

1. Hidden risks
2. Simpler alternatives
3. Likely breakpoints
4. Missing files or context
5. Whether the plan is too broad
6. Recommended acceptance criteria

Codex should not implement during this phase.

### Phase 3 — Revised Plan

Claude should revise the plan using Codex's feedback.

The revised plan must clearly state:

1. Final implementation scope
2. What will not be changed
3. Files expected to be edited
4. Test/check commands to run
5. User approval question if needed

### Phase 4 — User Approval

If the task is medium or high risk, stop and wait.

Do not implement until the user approves.

### Phase 5 — Implementation

Claude implements in small diffs.

Rules:

- edit only files named in the approved plan unless a new issue is discovered
- if scope expands, stop and ask
- do not install packages unless approved
- do not change schema unless approved
- summarize each major change

### Phase 6 — Codex Review of Changes

Codex reviews the actual diff.

Codex should check:

- build errors
- type errors
- broken imports
- unnecessary file changes
- security issues
- schema risks
- overengineering
- mismatch with approved scope

Codex should not add features.

### Phase 7 — Fix Confirmed Issues

Claude fixes only confirmed issues from Codex review.

If Codex suggests a broader improvement, do not implement unless user approves.

### Phase 8 — Final Summary

Final response must include:

1. Files changed
2. What was implemented
3. Checks run
4. What still needs manual testing
5. Remaining risks

---

## Codex Review Instructions

When reviewing, Codex should be skeptical.

Codex should look for:

- unnecessary complexity
- broken assumptions
- missing edge cases
- incorrect data flow
- hidden schema implications
- unsafe environment handling
- files changed outside scope
- UI regressions
- build/typecheck failures

Codex should not praise the work unless there is a reason.

Codex should produce actionable findings only.

Use this severity system:

- Critical: must fix before continuing
- Major: likely bug or serious maintainability issue
- Minor: improvement, not blocking
- Nit: optional cleanup

---

## Implementation Boundaries

Agents must not modify these unless explicitly approved:

- `.env`
- `.env.local`
- deployment settings
- production database settings
- Supabase migrations
- authentication providers
- payment logic
- user data deletion logic
- package manager files
- CI/CD configuration

Package manager files include:

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`

If a package change is needed, explain why and wait.

---

## Testing and Validation

After implementation, run the smallest relevant checks available.

Prefer:

```bash
npm run typecheck
npm run lint
npm run build
```

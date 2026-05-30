# Intent Document

## Current Round

- Round:
- Status:
- Previous plan backup:

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> Paste the requirement-bearing user input verbatim. Do not summarize or clean it.

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1    | User    |                  |                  |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
|        |      |                |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | |
| Normal archive | Commit containing `openspec archive <change>` result | |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
|               |                         |                         |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
|             |                 |                                        |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
|      |                     |                          |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
|          |                               |                                       |

## Intent

### Surface Intent

What the user asked for in their own language.

### Underlying Drive

The deeper product/architecture pressure inferred from the user's language, prior decisions, and current repo facts.

### Final Visible Effect

Describe what the operator will see, trust, or stop worrying about when this change is correct. For backend-only work, describe the external proof surface.

## Platform Diagnosis

- Current platform laws:
- Does this fit as a regular atom:
- Does this require law upgrade:
- Breaking update stance:
- User confirmations still required:

## Reverse-Inferred Design

### Interaction / Visual Story

Describe the ideal observed flow before naming implementation details.

### Interface Shape

Describe the contracts in product language first.

### Data Shape

Describe durable facts, projections, and state that must not be confused.

### Architecture Shape

Describe atoms, laws, ownership boundaries, and forbidden couplings.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
|      |                              |                            |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
|          |                |                                       |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
|      |              |

## Exit Conditions

- Default max review iterations:
- Issue recurrence threshold:
- Custom exit condition from intent:

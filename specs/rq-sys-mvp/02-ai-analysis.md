# Spec 02 — AI Requirement Analysis

Status: [ready-for-agent] for the approved MVP output; target model/provider and data-retention POC remain gates.

## Problem and outcome

The MVP needs explainable, bounded AI suggestions after source data is saved. AI must distinguish source facts from inference, avoid personal data, and never become a push gate or a substitute for PM decisions.

## User stories

1. As a PM, I want a controlled module suggestion with evidence, so that I can route a requirement without relying on a free-form category.
2. As a PM, I want one overall high/medium/low confidence with reasons and source evidence, so that I can judge how much to trust the suggestion.
3. As a PM Leader, I want U/M/S/C recommendations and blind spots, so that I can review value and missing information before calibrating priority rules.
4. As an operator, I want an initial AI failure to be visible but non-blocking, so that a requirement can still be pushed and reviewed.
5. As a PM Leader, I want a retry to create a new analysis version without overwriting PM-confirmed values, so that failures and changes remain traceable.

## Input contract

The model may receive:

- Requirement title and description.
- Necessary non-personal business context already present in the source record.
- The current versioned module dictionary and, when published, the relevant priority-rule version.

The model must not receive:

- Proposer/owner names or user IDs.
- Contact details; phone numbers and email addresses must be masked before the request.
- Attachment files or attachment contents.
- Credentials, access tokens, or unrelated project data.

## Output contract

Persist a versioned, schema-validated result containing:

| Output | Rule |
|---|---|
| Module suggestion | Must be an item in the active controlled dictionary, or 其他 / 待分类 with the PRD-defined distinction |
| Overall confidence | Exactly one of 高 / 中 / 低; include an overall reason and source-text evidence; not a probability |
| U/M/S/C recommendations | Each recommendation includes rationale, cited evidence or an explicit missing-evidence marker |
| Facts and inference | Store separately; inferred claims must be labeled as AI inference |
| Missing inputs / blind spots | Explicit list; never fabricate absent source data |
| Priority | Blank when there is no published rule version; after publication compute deterministically for new analyses/manual reruns only |
| Provenance | Analysis version, generated time, model/prompt version, dictionary version, and applied rule version if any |

The MVP does not require virtual-user/KANO output, VOC/NPS scoring, final adoption decisions, solution commitments, or autonomous PM assignment. These are deferred according to the PRD Roadmap.

## Workflow and failure behavior

1. Run analysis only after source snapshot persistence succeeds.
2. Validate output shape, controlled-module membership, and evidence references before storing it.
3. A valid result sets AI state to 已分析. An invalid response, model error, or timeout sets AI state to 分析失败待重试 with a safe error summary.
4. After the first attempt reaches success, failure, or timeout, continue the owner/push pipeline. Do not await a later retry.
5. A later retry creates a new analysis attempt/version and updates only AI-owned fields. It does not overwrite PM-confirmed fields.
6. AI failure is per requirement and does not mark a successfully pulled batch as a pull failure.
7. Low confidence, missing priority, or missing optional context never blocks push.

The technical design mentions one timeout retry. Interpret this as a queued/non-blocking retry after the first attempt is recorded; if it is intended to delay push, that conflicts with the PRD and requires a decision in OPEN-DECISIONS.md.

## Interface contract

- Analysis is an internal service boundary invoked by the pipeline after snapshot persistence.
- POST /api/analysis/{id}/retry — enqueue a new analysis attempt for an eligible requirement.
- GET /api/requirements/{id} — return source facts, the latest AI version, prior versions as permitted, and separate pipeline state.
- Every retry request records actor, request time, target source version, and analysis version.

Do not bind the product contract to a single model vendor. A provider adapter owns request formatting, timeout, retry classification, and credential handling.

## Acceptance criteria

1. Given a requirement with enough evidence, when analysis succeeds, then it stores a controlled module, one overall confidence, evidence, U/M/S/C recommendations, missing information, and version metadata.
2. Given weak evidence, when analysis completes, then it can return low confidence or 待分类 and clearly state why; it must not invent a fact.
3. Given malformed model output or provider failure, when the attempt terminates, then the error is persisted and the requirement can continue to owner matching and push.
4. Given low confidence or a blank priority, when push is eligible, then push is not blocked.
5. Given no published priority rule, when analysis runs, then P0–P3 is empty while U/M/S/C suggestions remain visible.
6. Given a rule is published, when a new analysis or explicit rerun occurs, then the deterministic rule version is recorded and only that new result is computed; older records are not backfilled.
7. Given an AI rerun succeeds, then PM confirmation fields are unchanged and the new AI result is separately traceable.
8. Given private or attachment data in a source record, then those fields are absent or masked in the outbound model request.

## Verification strategy

Use a real approved test model endpoint with a small, approved, minimized data set. Verify one normal response, low-evidence response, invalid structured response, timeout/failure, and retry through the analysis API. Inspect outbound payload redaction and stored versions. A mocked model may support frontend layout but does not establish model integration or data-handling acceptance.

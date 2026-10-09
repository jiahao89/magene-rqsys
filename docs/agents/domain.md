# Domain Documentation Rules

- This is a single-context RQ-Sys MVP repository. Domain specs, decisions, contracts, and architecture notes live under `specs/rq-sys-mvp/`.
- Before changing behavior, read the root `AGENTS.md`, `CONTEXT.md`, `specs/rq-sys-mvp/README.md`, the relevant numbered spec, `OPEN-DECISIONS.md`, and `openapi.yaml` when touching APIs.
- The current Feishu MVP PRD revision 60 controls product behavior. `AGENTS.md` states the domain invariants; do not infer new product behavior from implementation convenience.
- Ticket drafts under `.scratch/rq-sys-mvp/issues/` are local and dependency-ordered. Re-read the README before ticket edits; keep its status row synchronized with the ticket and append evidence.
- Treat local tests and adapters as local implementation evidence only. “Integrated”/“connected” claims require actual target-environment verification; otherwise say “implemented, not verified in target environment.”
- Do not deploy/write to Miaoda or modify external collaborators while Spark write access is blocked. Keep identity adaptation deferred until Miaoda identity is verified.

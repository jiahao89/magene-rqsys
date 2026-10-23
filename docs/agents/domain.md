# Domain Documentation Rules

- This is a single-context RQ-Sys MVP repository. Domain specs, decisions, contracts, and architecture notes live under `specs/rq-sys-mvp/`.
- Approved V0.2 increments live under `specs/rq-sys-v0.2/`; read its README, relevant numbered spec, field-ownership guidance, and decision gates when changing manual intake, unified identity, audience analysis, Base key compatibility, or RICE/Kano Beta. It extends the MVP only in its explicitly approved scope.
- Before changing behavior, read the root `AGENTS.md`, `CONTEXT.md`, `specs/rq-sys-mvp/README.md`, the relevant numbered spec, `OPEN-DECISIONS.md`, and `openapi.yaml` when touching APIs.
- The current Feishu MVP PRD revision 60 controls product behavior. `AGENTS.md` states the domain invariants; do not infer new product behavior from implementation convenience.
- Ticket drafts under `.scratch/rq-sys-mvp/issues/` are local and dependency-ordered. Re-read the README before ticket edits; keep its status row synchronized with the ticket and append evidence.
- V0.2 tickets use `.scratch/rq-sys-v0.2/issues/` with their own README and dependency/status tracking. The 2026-10-23 approval covers the specification and ticket breakdown; unresolved rule parameters, materials, and target-environment write gates remain binding.
- Treat local tests and adapters as local implementation evidence only. “Integrated”/“connected” claims require actual target-environment verification; otherwise say “implemented, not verified in target environment.”
- Do not deploy/write to Miaoda or modify external collaborators while Spark write access is blocked. Keep identity adaptation deferred until Miaoda identity is verified.

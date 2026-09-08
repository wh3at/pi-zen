# Domain Docs

## Layout

Single-context: root `CONTEXT.md` and `docs/adr/`.

## Before exploring

Read `CONTEXT.md` and ADRs in `docs/adr/` relevant to the work.

If these files do not exist, proceed silently. Domain-modeling
creates them lazily when terms or decisions are resolved.

## Vocabulary

Use the domain terms defined in `CONTEXT.md` in issues,
proposals, hypotheses, and tests. If a needed concept is absent,
reconsider the term or note the gap for domain-modeling.

## ADR conflicts

Explicitly flag any proposal that contradicts an existing ADR,
identifying the ADR and why the decision deserves reconsideration.

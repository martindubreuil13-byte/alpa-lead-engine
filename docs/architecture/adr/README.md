# Architecture Decision Records (ADRs)

This directory contains architectural decisions for ALPA. Each ADR documents a major architectural decision, its rationale, alternatives considered, and consequences.

## Purpose

ADRs serve as:
- Permanent reference for why architectural choices were made
- Context for future developers joining the project
- Constraints for future feature design
- Documentation of load-bearing principles

## Format

Each ADR follows a standard template with these sections:
- **Title** — Clear, descriptive name
- **Status** — PROPOSED, ACCEPTED, SUPERSEDED, DEPRECATED
- **Date** — When decided
- **Context** — The situation requiring a decision
- **Problem** — What needed to be resolved
- **Decision** — What we decided and why
- **Alternatives Considered** — Other options and why they were rejected
- **Consequences** — What changes as a result
- **Future Considerations** — How this might evolve

## Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| [ADR-001](./ADR-001-my-leads-repository.md) | My Leads is the Permanent Business Repository | ACCEPTED | 2026-07-07 |
| [ADR-002](./ADR-002-database-single-source-of-truth.md) | Database is the Single Source of Truth | ACCEPTED | 2026-07-07 |
| [ADR-003](./ADR-003-commercial-intelligence-architecture.md) | Commercial Intelligence Architecture | ACCEPTED | 2026-07-07 |
| [ADR-004](./ADR-004-module-responsibility-principle.md) | Module Responsibility Principle | ACCEPTED | 2026-07-07 |

## Creating New ADRs

1. Copy `TEMPLATE.md` to `ADR-NNN-title.md` (increment the number)
2. Fill in all sections following the template structure
3. Keep it concise (1-2 pages maximum)
4. One decision per ADR
5. Add to the index above
6. Link related ADRs using `[[ADR-NNN]]` notation

## Guidelines

**Be concise:** A good ADR is 1-2 pages. If it's longer, consider splitting into multiple ADRs.

**Document tradeoffs:** Explain why alternatives were rejected, not just what was chosen.

**Think long-term:** How will this decision affect the architecture in 6 months? 1 year? 3 years?

**Respect constraints:** Each ADR constrains future decisions. Choose carefully.

**Link related decisions:** Use `[[ADR-NNN]]` to reference related architectural decisions.

## Status Meanings

- **PROPOSED** — Under discussion, not yet finalized
- **ACCEPTED** — Approved and in effect
- **SUPERSEDED** — Replaced by a newer ADR; reference the superseding document
- **DEPRECATED** — No longer relevant; kept for historical context

## References

This ADR system is inspired by:
- [Architectural Decision Records](https://adr.github.io/) (adr.github.io)
- [Michael Nygard's Original Proposal](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

---

**Last updated:** 2026-07-07  
**System established by:** Phase 0 Architectural Foundation Initiative

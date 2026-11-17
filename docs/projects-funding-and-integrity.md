# Projects & Operations: funding, identity, and settlement

This reference describes the **current Beta engine** following the BETA-3 integrity pass. It is not a proposal to create a new treasury. The Statistics V2 scoped-metrics RFC governs eventual national fiscal authority. Source code remains authoritative for implementation details.

## Ownership and identity

- `world.projects` contains canonical project records. IDs are the project identity; names are presentation, not unique keys.
- Project operations prefer explicit `projectId`, validate the actual owner and refuse ambiguous name-only matching. Player controls cannot modify another country's project by reusing a title or ID.
- Normal project additions are refused once the 120-entry board is full. **Debt:** normalization of legacy saves already over that cap can still evict old records; no archive/migration policy has been approved.
- Native project clock outcomes carry `projectId`, owner and name. Completion effects match exact ID and owner; legacy name-only outcomes require one unique match within that owner. The public project-outcome filter likewise checks ID, owner, title consistency, and public secrecy.

## Multiplayer seat-board lending

- During a shared time skip, `src/multiplayer/host/seatBoards.js` temporarily lends each guest's owned open projects to the host's canonical `world.projects` board, leaving the source copies in `world.seatBoards`. Lending is constrained to the existing board capacity, with room reserved for the skip's own projects.
- Lending now uses **stable project IDs, not globally unique names**. A host project and a guest project may share the title "Riga port"; both can be simulated, and two distinct same-name projects within a seat remain distinct.
- The transient `world.projectSeatLoans` maps loaned project IDs to guest countries. It is **host-only** under multiplayer view projection, survives canonical normalization during a round, and is cleared when loans come home or an interrupted round is settled. A guest ID collision cannot evict an unrelated host project from the active board.
- Project IDs are still assumed globally unique across canonical records. The engine refuses to lend a duplicate ID; it does not mint an alias or overwrite the host's record to compensate.
- **Outstanding:** project boards that were already over the 120-entry cap, and the return of new guest projects onto a full guest board, still need a separate explicit retention/admission contract. Do not silently relax the cap or move a genuinely active entry into a closed archive.

## Scenario funding modes (not fiscal ledgers)

`world.projectFundingMode` is a scenario-level, enumerated **basis for work**, selected in the Scenario Editor and copied into new campaign worlds. Normalization accepts only:
- `gdp-proxy` (default, also for old saves and invalid policy strings). `monthlyProjectBudget` estimates an allowance from **native** `world.countryStats[owner].economy.gdp` × 2% annually, adjusted by budget-balance/debt percentage ratios through the existing treasury factor. This is a work allocator, **not treasury cash**; `project.spent` is internal cumulative paid-project expense, not a transaction on government debt or balance. Positive planned costs cannot claim payment or progress when native GDP is missing, zero or unassessed. A genuinely zero-cost plan can still progress.
- `nonmonetary` (explicit author choice). Suitable for medieval, fantasy or other scenarios that should simulate projects by time and capacity rather than currency. Projects progress according to the ordinary deterministic clock and effort/funding level, with **no monetary payments recorded**. This mode is not a method to acquire cash or silently invent GDP; `project.spent` is unchanged, and government economic fields are not touched. Existing accumulated expenses are preserved as historical values on conversion. There is no inference from custom Stats names.

The Projects UI distinguishes **planned cost/month**, **cumulative amount actually paid**, the **estimated allowance**, and the absence of a native GDP baseline. In nonmonetary mode it reports time/capacity rather than a fake currency cost. The ordinary project funding selector still controls the work pace; it is not a government appropriation.

A scenario author chooses the nonmonetary mode in **World → Projects funding basis**. Legacy scenarios preserve GDP-proxy default unless explicitly edited. A current live campaign's funding basis must not be silently flipped when editing scenario defaults.

## Work, completion, and territorial consequences

- The deterministic `tickProjects` engine advances progress, installments, milestones, stalls and resumes; it does not ask AI to calculate daily payment.
- `applyProjectOutcomesToWorld` releases bounded stat/relations/structure/unit-type effects and prepares legal-territory operations using the same existing canonical event writer.
- `settleProjectTerritoryWorld` checks map resolution before invoking the canonical `applyEventImpactsToWorld` event writer and verifies resulting legal sovereignty/claims. If a transfer is unresolved, silently dropped, or not applied, it throws: the **unwritten turn must fail** instead of publishing a completion latch with missing territorial consequences. No duplicate territory ledger is introduced. An outcome's statistical effects and territorial changes are part of the same in-memory turn preparation before publication.
- Scope limitation: this adapter does not add a general durable cross-asset transaction/receipt service; it does not independently validate all polity-only changes, and event-model disclosure of classified project identities is not fully resolved. Test live save/reload, rollback, and multiplayer before release.

## Secrecy and information

Project visibility is chosen by the player at creation, adjustable on owned projects, and recorded as public/restricted/covert. Foreign `list_projects` lookup filters existing hidden data. Ordinary time-skip public project summaries and native milestone forecast omit classified work; owner-advisor detailed views retain it. Omniscient simulation, independently generated prose and diplomacy are **not** guaranteed safe by this measure. Future Canon knowledge/disclosure needs typed actor-specific evidence/receipts and native output authorization; do not substitute name keyword blacklists or longer prompts.

## Statistics V2 integration contract (future work, not implemented)

The accepted Statistics V2 redesign is national/geopolitical and requires one authoritative reading per semantic metric, explicit native/custom bindings, dated causal updates, and **unset distinct from zero**.

For the future financial integration:
1. Keep `projectFundingMode` an explicit scenario authoring choice, not an alternative native money balance. The future fiscal authority may add an enumerated `fiscal` mode only through a separate schema design and migration, never by reinterpreting existing `nonmonetary` entries.
2. Treat the GDP-proxy allowance as **interim planning capacity only**. Do not subtract `project.spent` directly from GDP: GDP is output, budget balance and public debt are ratios, not a cash stock. Never translate a scenario custom metric named `gdp` into the native backend without an approved binding.
3. Future spending must be accepted by a single national fiscal owner through a typed, dated, idempotent **appropriation/settlement receipt** keyed by stable `projectId` plus polity identity, campaign/period, amount and proper unit. The canonical writer, not Projects, decides cash/financing and debt consequences. Project progress and fiscal receipts must reconcile on exactly the same accepted settlement.
4. Explicit nonmonetary work remains valid without native GDP; preserve saves and their non-cash semantics. Switching funding policy is a durable, authorized scenario/campaign transition and needs its own migration rules.
5. Validate chronology/period partition, retries, Undo, interrupted turn, multiplayer host ownership, multiple simultaneous spenders (military, war, institutions, Actions), missing GDP, custom Stats, and historical/fictional scenarios.

## Remaining integration debt

- `src/runtime/gameState.js` writes the whole `world.json` through `writeJson` with no revision-aware compare-and-swap. Projects' panel read/edit/write can race the Stats worker and other world writers, despite the per-turn batch-publication protections. **This requires a shared canonical world mutation contract across all writers**, not a Projects-only queue or retry.
- Existing legacy boards above 120 projects need explicit non-destructive archival/admission semantics.
- Full native intelligence/disclosure controls remain incomplete across event generation and diplomacy.
- GDP-proxy funding and `project.spent` are not reconciled with treasury/fiscal accounting. The interim mode and UI **do not claim otherwise**.
- Release acceptance must include real playtest scenarios: missing GDP, author-selected nonmonetary work, legacy saves, identical project titles, ownership transfer, covert projects, legal transfer refusal, scenario creation/reload, full tests and production build.

## Code ownership

`src/runtime/projectEngine.js`: funding basis, deterministic work, plan limits and preview.
`src/runtime/gameState.js`: canonical world normalization, authorization, project outcome effects.
`src/runtime/projectTerritorySettlement.js`: fail-closed completion-to-map adapter.
`src/Game/AI/gameplay.js`: time-skip turn orchestrator and existing canonical event writer.
`src/Game/GameUI/projects.jsx`: player controls, visibility, funding presentation.
`src/Game/GameUI/libraryBar.jsx`: scenario-authoring funding basis.
`server/libraryStore.js`: new-game scenario-world seed override.

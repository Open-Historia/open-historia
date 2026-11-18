# Projects & Operations: funding, identity, and settlement

This reference describes the **current Beta engine** following the BETA-3 integrity pass. It is not a proposal to create a new treasury. The Statistics V2 scoped-metrics RFC governs eventual national fiscal authority. Source code remains authoritative for implementation details.

## Ownership and identity

- `world.projects` contains canonical project records. IDs are the project identity; names are presentation, not unique keys.
- Project operations prefer explicit `projectId`, validate the actual owner and refuse ambiguous name-only matching. Player controls cannot modify another country's project by reusing a title or ID.
- Normal project additions are refused once the 120-entry board is full. **Legacy over-cap saves fail closed** with `ProjectBoardOverflowError` instead of discarding records. An explicit save-owner recovery tool in the Games library can now create a **separate recovered copy**, with every selected project preserved in a reversible archive. The source game is never overwritten.
- Legacy entries without IDs now acquire deterministic, Unicode-safe migration identities based on owner namespace, title, recorded creation/start dates, summary and occurrence ordinal for otherwise indistinguishable duplicates. Existing IDs are preserved, no wall-clock creation/update timestamps are fabricated, and seat-board normalization uses the guest country for blank owners. An imported board with colliding explicit IDs is rejected with `ProjectBoardIdCollisionError` instead of dropping a record.
- Native project clock outcomes carry `projectId`, owner and name. Completion effects match exact ID and owner; legacy name-only outcomes require one unique match within that owner. The public project-outcome filter likewise checks ID, owner, title consistency, and public secrecy.

## Multiplayer seat-board lending

- During a shared time skip, `src/runtime/seatBoards.js` lends each guest's owned open projects to the game's board **in the skip's own copy of the world only** (`withBoardsLent` at the skip's one read), each marked `lentFrom` its seat, and returns them in the turn's one commit (`withBoardsHome`). The stored world never holds a lent entry, and lent entries count toward no cap of the game's board (`capProjectList`), so every seat's open work rides every skip.
- **Stable project IDs, not names, are identity.** A host project and a guest project may share the title "Riga port"; both are lent and simulated, the guest's under "Riga port (country)" so the skip can name each, and each comes home under its own name. Two distinct same-name projects within a seat remain distinct. The engine refuses to lend an ID the game's board already holds; it never overwrites the host's record.
- `lentFrom` survives canonical normalization, so a normalized skip copy still sends each entry to the right seat.
- A save from an older lending (one that wrote the lending into the stored world) is settled at the next skip or view (`settleBoards`): an entry on the game's board is taken for a leftover copy only where that lending says so, by a beta save's `world.projectSeatLoans` manifest (ID to seat) or else by the seat's country written as its owner. A shared ID alone never moves an unrelated host project to a guest's board. The manifest is read and dropped, and is **host-only** in multiplayer projections meanwhile.
- **Outstanding:** when new guest projects are returned onto a guest board that has become full during a time skip, admission still needs its own native rule. The library recovery tool handles preexisting over-cap host and guest boards out of band; it refuses a save still carrying a loan manifest.

## Recovery of oversized legacy campaigns

From a game card's **More → Recover Projects…** menu, the save owner can inspect the raw, exported campaign (including one that fails `normalizeWorldState` because its board exceeds 120). This is a **library-level save-maintenance operation**, never the player's in-world foreign-projects view.

- The tool enumerates every main and multiplayer seat Projects board. It requires an **explicit checkbox selection** of enough records to bring *every* board to 120 or fewer. No automatic eviction, forced archiving or default choice. A highlighted warning and confirmation explain that manually shelved **active** projects will stop advancing until restored.
- Only after validation does it create a **new imported campaign** with the surviving projects in `world.projects`/`world.seatBoards`, and the complete original selected project records in bounded `world.projectRecoveryArchive` (maximum 512 records). Every archive entry stores its canonical ID, original board, source project object, prior status and in-game shelving date. Unknown historical project fields remain intact. The original save and its game identity are not modified.
- The new campaign retains all other world and game data and its scenario reference. Restore-point history is copied only when the source world is already on the current country-owner schema; otherwise native owner migration would discard incompatible rollback files on first activation. The interface warns before recovery. Old restore points remain in the **original** game and are never rewritten by recovery. Even compatible copied restore points may contain oversized boards and require another recovery if applied. The tool never silently rewrites history.
- From the same game's recovery menu, **Restore shelved** can create another new copy returning explicitly selected records to their original board. A full 120-row board can **swap** one explicitly selected live record into the archive while restoring one archived record in the same transaction, without an intermediate clone. It does not backfill simulated progress for skipped time.
- Recovery inspects malformed records and ID collisions without silently skipping them, refuses a pending multiplayer project-loan manifest, and does not weaken `normalizeProjects` or its 120-entry cap. The archive is **host-only** in multiplayer projections: it may contain covert work and must not become a guest's intelligence feed.
- The archive is held in `world.json` for save-portable state, with a separate 512-record limit. It adds JSON weight to affected recovered games; it is not a second ticking board. A future off-world storage optimization needs a separately reviewed game-bundle and browser/desktop migration.
- Validation includes runtime recovery tests, actual desktop and browser export/import round trips, a native time-advance / disk-save / reload / restore smoke test, and an isolated headless Chrome library→recovery→create-copy UI interaction. The modal was visually inspected at desktop width and 375 px mobile width without horizontal overflow. **A real model/provider campaign playtest, human-operated desktop acceptance, real host/guest session and archival bandwidth measurements remain pending.**

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

- The Projects player panel now uses existing `mutateWorldState` for its native, authorized write operation: the read and write occur inside the shared canonical page queue, which also coordinates the page's Stats-worker handoff and guards against campaign switches. Other direct world writers and cross-process clients still lack durable revision-aware compare-and-swap. **This remains a shared canonical persistence boundary**, not an excuse to add a Projects-only queue or declare cross-process atomicity achieved.
- A library-level recovery workflow can now copy oversized legacy games into a valid board state with all manually shelved records preserved and restorable. An over-cap **original** remains blocked until the save owner performs recovery; no implicit migration occurs. Duplicate explicit-ID or malformed-entry repairs beyond the safe inspection contract still require separately authorized, source-specific treatment.
- Full native intelligence/disclosure controls remain incomplete across event generation and diplomacy.
- GDP-proxy funding and `project.spent` are not reconciled with treasury/fiscal accounting. The interim mode and UI **do not claim otherwise**.
- Release acceptance must include real playtest scenarios: missing GDP, author-selected nonmonetary work, legacy saves, identical project titles, ownership transfer, covert projects, legal transfer refusal, scenario creation/reload, full tests and production build.

## Code ownership

`src/runtime/projectEngine.js`: funding basis, deterministic work, plan limits and preview.
`src/runtime/gameState.js`: canonical world normalization, authorization, project outcome effects.
`src/runtime/projectTerritorySettlement.js`: fail-closed completion-to-map adapter.
`src/runtime/projectRecovery.js`: recovery inspection and clone-bundle assembly; preservation of original records and board-cap checks.
`src/Game/GameUI/ProjectRecoveryDialog.jsx`: save-owner explicit shelving/restoration interface.
`src/multiplayer/host/projection.js`: host-only projection of recovery archive.
`src/Game/AI/gameplay.js`: time-skip turn orchestrator and existing canonical event writer.
`src/Game/GameUI/projects.jsx`: player controls, visibility, funding presentation.
`src/Game/GameUI/libraryBar.jsx`: scenario-authoring funding basis.
`server/libraryStore.js`: new-game scenario-world seed override.

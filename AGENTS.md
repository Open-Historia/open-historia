# Instructions for coding agents

These apply to every agent working in this repository: Claude Code, Codex, Copilot and any other. Read them before you change anything. The repo's conventions are in [docs/conventions.md](docs/conventions.md), and the developer documentation starts at [docs/README.md](docs/README.md).

## Standing order: every update players will notice ships with its update notice

When the game opens after an update, the vault door opens onto a notice announcing what the update brings. The main menu's logo opens the history of every update. Both are written by whoever makes the update. **That is you: do it without being asked, in the same pull request as the change.** A player-facing change without its notice is unfinished.

Before you finish any task, check:

1. **Does this change reach players, and would a player notice it?** That means a new feature, screen, tool or setting, a rule of play that changed, a new platform, or a fix of something players hit. If not (refactors, tests, CI, docs, internal or training tools), stop here: no notice.
2. **Add or extend the entry** at the top of `NEW_UPDATES` in `src/Game/GameUI/updates/notes.js`. Never add to `notesPast.js`, which holds the history from before notices existed:
   - A **minor** update gets a plain card of 3 to 6 lines.
   - A **major** update, one with a headline feature, gets banners with a lead and sections.
   - If the newest entry belongs to the same batch and has not reached players yet, extend it. Otherwise add a new entry with a new id, `YYYY-MM-<slug>`.
   - Never reuse or rename an id that has shipped.
3. **Give a major update its own look.** Copy `src/Game/GameUI/updates/themes/ThemeTemplate.jsx`, make its chrome so its buttons and markers are themed too, and register both in `themes/index.js`. It must be decorated, and animated where it suits, in a style that fits that update (not every update is a war update). Never use gradients or purple. Respect Reduce motion, and check it at phone width.
4. **Write for a player:** plain words about what they can now do or see. Never put internal names, file names, ids or PR numbers in the text.
5. **Add new interface strings** to `public/lang/catalog-en.json`, kept sorted.
6. **Look at it** with `?updateNotice=<id>` in the address, and run:
   ```bash
   node --test src/Game/GameUI/updates/updateNotices.test.js src/noGradients.test.js src/runtime/i18nCatalog.test.js
   ```

The complete guide is **[docs/update-notices.md](docs/update-notices.md)**: when to write one, the entry format with examples, how to build a theme, the kit, the house rules and how devices are shown updates. Follow it exactly.

When a feature is promoted to another branch (alpha, then beta, then main), its notice entry goes with it. Promote only the lines for what was promoted.

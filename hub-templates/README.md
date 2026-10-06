# Community hub issue templates

These GitHub **issue-form templates** live in the community hub repo, **not** in this
app repo. They are kept here only as source-of-truth copies so changes are reviewed
alongside the client code that links to them.

To take effect, copy them into the hub repo:

```
Open-Historia/Open-historia-scenarios/.github/ISSUE_TEMPLATE/basemap.yml
```

- **`basemap.yml`** — the "Share a basemap" form. The editor's Basemap picker links
  to it via `…/issues/new?template=basemap.yml`. The form declares `labels: [basemap]`,
  which is applied for every submitter (a `?labels=` URL param is silently dropped for
  users without push access — the form is the reliable way to label community posts).

  **One-time setup:** create a label named exactly `basemap` in the hub repo (Issues →
  Labels → New label). A form can only apply a label that already exists; without it the
  posts submit unlabeled and the editor's Community → Basemaps tab (which queries
  `labels=basemap`) stays empty.

The existing `scenario.yml` already lives in the hub repo. Its file-drop field also
accepts the new `.zip` bundle a scenario with a custom basemap now downloads — no change
required, though you may want to reword its help text to mention "(.json or .zip)".

## Basemaps carried by scenarios

The editor's Community → Basemaps browser lists **two** sources:

1. Dedicated `basemap`-labeled posts (from `basemap.yml`).
2. `scenario`-labeled posts whose bundle is a **`.zip`** — a zip scenario carries a
   custom basemap, so the browser surfaces it as a "from scenario" basemap and installs
   it by extracting `basemap.<ext>` from that zip. **No second upload is needed** — sharing
   the scenario is enough to make its basemap browsable.

**Optional (recommended) `scenario.yml` tweak for dedup:** add a hidden-ish textarea so a
scenario post can record its basemap hash — then a basemap shared via a scenario dedupes
against a dedicated basemap post (shown once) and can be referenced by future scenarios.
Add this field to `scenario.yml` (the app already prefills it):

```yaml
  - type: textarea
    id: technical
    attributes:
      label: Technical info (do not edit)
      description: Auto-filled when the scenario has a custom basemap. Lets the game dedupe it.
      value: |
        Basemap-Hash:
        Basemap-Kind: image
    validations:
      required: false
```

Without this field everything still works; scenario-carried basemaps just can't be deduped
(they may appear alongside an identical dedicated post).

## Suggested changes (no template change)

A player who downloaded a scenario and edited it can suggest the changes to its author
(`src/Game/GameUI/ScenarioSuggestions.jsx`). The suggestion is a **comment on the
original post**, made by the player, with a small `<scenario>-suggestion.zip` attached
(`open-historia-scenario-suggestion/1`: `suggestion.json`, plus `files/cover.<ext>` or
`files/background.json` when those changed). The comment ends with a marker line:

```
Open-Historia-Suggestion: sug-1a2b3c4d
```

The author's game counts a comment as a suggestion when it has a `.zip` attachment, and
either the file name contains "suggestion" or the marker is present
(`parseSuggestionComment`, `src/runtime/hubPosts.js`). Any other comment is only a
comment.

The author's game recognises its own posts by a key that **Publish** writes into the
`technical` field of `scenario.yml`: the line `Scenario-Key: oh-<16 hex>`, next to
`Basemap-Hash` / `Flags-Count`. The live form already has that field (its label is
"Basemap info (auto-filled — leave blank)"). The line only works if the field keeps the
id `technical` and is not required to be empty. A post made before this version, or one
whose author cleared the field, carries no key, and its author's game cannot follow it:
a post cannot be linked to a scenario by hand. Publishing the scenario again makes a
post that carries one.

The author can unlink a post from the scenario's Community card (**Unlink the post**),
and that is for good: the game never follows that post again, even if it is edited to
carry the key of a later one.

Everything is read without signing in. GitHub's unauthenticated API allows 60 requests
an hour: the game reads the scenario list at most once every five minutes, and reads a
post's comments only when its comment count has moved.

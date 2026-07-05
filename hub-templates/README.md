# Community hub issue templates

These GitHub **issue-form templates** live in the community hub repo, **not** in this
app repo. They are kept here only as source-of-truth copies so changes are reviewed
alongside the client code that links to them.

To take effect, copy them into the hub repo:

```
Arkniem/pax-historia-scenarios/.github/ISSUE_TEMPLATE/basemap.yml
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

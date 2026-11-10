# Code signing

<!-- Open Historia — code signing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

| System | Signed by | Where |
|---|---|---|
| Windows (stable and beta) | SignPath Foundation, once it is set up below | `.github/workflows/desktop-installer.yml`, `desktop-beta.yml` |
| macOS | Not signed (ad-hoc only, `scripts/mac-adhoc-sign.cjs`) | — |
| Android | The project's own release key | `android-apk.yml`, `android-apk-beta.yml` |

Until the secret and the variables below exist, both desktop workflows build exactly what they built before: unsigned, with the same files, names, feeds and update chunks. Every signing step is skipped.

## How a signed Windows build is made

On the Windows job only, after the ordinary `Build the installer` step:

1. The app's own programs (`release/win-unpacked/*.exe` and the `.exe`/`.node` files under `resources/app.asar.unpacked`, i.e. the system speech program) go up as a GitHub artifact and are sent to SignPath. The job waits for the signed files and copies them back.
2. The installer is rebuilt around the signed app with `electron-builder --prepackaged release/win-unpacked`, so it packs the signed programs. That installer goes to SignPath in turn and comes back signed.
3. `scripts/refresh-update-feed.mjs` writes the signed installer's sha512 and size into `release/latest.yml` (electron-updater rejects a download whose hash does not match).
4. `Check the Windows signatures` fails the build if any of those files is not validly signed.
5. The update chunks are cut from the signed app, as before. After the upload, the release page gets the signing attribution and the policy link, once.

Each build is two signing requests, and SignPath Foundation requires a person to approve each one. The job waits up to an hour for each approval (its timeout is raised to 150 minutes while signing is set up).

Why not electron-builder's own `win.sign` hook calling SignPath per file: SignPath Foundation only signs what its GitHub connector can trace to a workflow run, which means submitting GitHub artifacts. Per-file calls from inside electron-builder would also make every file its own manual approval. Two requests per build keep it to two clicks.

The NSIS uninstaller that electron-builder generates inside the installer is not signed separately; it is only ever run from the installed copy.

## Owner checklist

1. **Apply** at <https://signpath.org/apply> (SignPath Foundation, free for open source) with the repository `https://github.com/Open-Historia/open-historia`. They check:
   - an OSI-approved license (AGPL-3.0-or-later, `LICENSE`), with no commercial dual licensing;
   - that releases are built from source on **GitHub-hosted runners** by the public repository's workflows (they are: `windows-latest`);
   - a **code signing policy** on the home page and the download page. It is the *Code signing policy* section of `README.md`, and every signed release page links to it;
   - multi-factor authentication on GitHub and SignPath for everyone on the team.
2. **Set up the SignPath project** they create for you:
   - Install the SignPath GitHub App for the repository if they ask (it lets SignPath read the workflow run that made each artifact).
   - Add an artifact configuration and paste in `.signpath/artifact-configuration.xml`. Make it the project's default, or note its slug for step 3.
   - Note the organization id (a GUID, in the organization's settings), the project slug and the signing policy slug (the Foundation's release policy, usually `release-signing`).
   - Create an API token for a CI user that may submit to that policy.
3. **Give the repository the settings** (from any checkout, signed in to `gh` as the owner):

   ```sh
   gh secret set SIGNPATH_API_TOKEN --repo Open-Historia/open-historia
   gh variable set SIGNPATH_ORGANIZATION_ID --repo Open-Historia/open-historia --body "<organization id>"
   gh variable set SIGNPATH_PROJECT_SLUG --repo Open-Historia/open-historia --body "<project slug>"
   gh variable set SIGNPATH_SIGNING_POLICY_SLUG --repo Open-Historia/open-historia --body "<signing policy slug>"
   # Only if the configuration from step 2 is not the project's default:
   gh variable set SIGNPATH_ARTIFACT_CONFIGURATION_SLUG --repo Open-Historia/open-historia --body "<artifact configuration slug>"
   ```

   Signing starts only when the secret and the three required variables are all set. Deleting any one of them switches it off again.
4. **Test it** without offering the build to anyone: Actions, *Desktop beta installers*, Run workflow from `beta` with **publish** unticked. Approve the two signing requests in SignPath when they appear. In the run, `Check the Windows signatures` lists each file as `Valid`, and the `open-historia-beta-windows-latest` artifact holds the signed `Open-Historia-Beta-Setup.exe` (Properties, Digital Signatures). The stable workflow has no such switch (an empty tag falls back to `desktop-stable`), so test it by dispatching with a throwaway tag such as `desktop-signing-test` and delete that release and its `-chunks` release afterwards.
5. Once a signed build is out, update the install texts that still say the Windows installer is not code-signed: `site/index.html` (the Windows tab), `wiki/start/install.md`, `wiki/reference/troubleshooting.md`. SmartScreen can still warn for the first downloads of a new certificate until it has built a reputation.

## macOS

Still unsigned. The Apple Developer Program would be needed for a Developer ID certificate and notarization; until then the macOS app is ad-hoc signed (`scripts/mac-adhoc-sign.cjs`) and players open it with *Open Anyway*, as the README says.

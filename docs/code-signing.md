# Code signing

<!-- Open Historia — code signing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

| System | Signed by | Where |
|---|---|---|
| Windows (stable) | SignPath Foundation, once it is set up below | `.github/workflows/desktop-installer.yml` |
| Windows (beta, native) | Not signed: SignPath Foundation signs only files named for the project (below) | — |
| macOS | Not signed (ad-hoc only, `scripts/mac-adhoc-sign.cjs`) | — |
| Android | The project's own release key | `android-apk.yml`, `android-apk-beta.yml` |

Until the secret and the variables below exist, the stable desktop workflow builds exactly what it built before: unsigned, with the same files, names, feeds and update chunks. Every signing step is skipped.

## How a signed Windows build is made

On the Windows job only, after the ordinary `Build the installer` step:

0. `Check the programs' product name and version` (`scripts/check-signing-metadata.ps1`) fails the run unless every file about to be sent says product *Open Historia* and this build's version.
1. The app's own programs (`release/win-unpacked/*.exe` and the `.exe`/`.node` files under `resources/app.asar.unpacked`, i.e. the system speech program) go up as a GitHub artifact and are sent to SignPath. The job waits for the signed files and copies them back.
2. The installer is rebuilt around the signed app with `electron-builder --prepackaged release/win-unpacked`, so it packs the signed programs. That installer goes to SignPath in turn and comes back signed.
3. `scripts/refresh-update-feed.mjs` writes the signed installer's sha512 and size into `release/latest.yml` (electron-updater rejects a download whose hash does not match).
4. `Check the Windows signatures` fails the build if any of those files is not validly signed.
5. The update chunks are cut from the signed app, as before. After the upload, the release page gets the signing attribution and the policy link, once.

Each build is two signing requests, and SignPath Foundation requires a person to approve each one. The job waits up to an hour for each approval (its timeout is raised to 150 minutes while signing is set up).

Why not electron-builder's own `win.sign` hook calling SignPath per file: SignPath Foundation only signs what its GitHub connector can trace to a workflow run, which means submitting GitHub artifacts. Per-file calls from inside electron-builder would also make every file its own manual approval. Two requests per build keep it to two clicks.

The NSIS uninstaller that electron-builder generates inside the installer is not signed separately; it is only ever run from the installed copy.

## SignPath Foundation's conditions, and how they are met

The conditions are at <https://signpath.org/terms>. Each one, and where this project meets it:

- **OSI licence, no proprietary code:** AGPL-3.0-or-later for everything (`LICENSE`); Electron's own DLLs are upstream open source, shipped unsigned inside the signed installer, which the terms allow.
- **Sign only our own binaries, built from source in a verifiable way:** only the stable workflow on GitHub-hosted runners submits, through SignPath's GitHub connector, which traces each artifact to its run. Only the app's program, the speech program built from `electron/speech/windows.cs`, and the installer are in the requests (`.signpath/artifact-configuration.xml`).
- **Metadata set and enforced:** the artifact configuration restricts every signed file to product name *Open Historia* and product version `${version}`, a required parameter the workflow passes (the stamped `0.0.<run>`). electron-builder writes the program's product version as `0.0.N.0`, so `scripts/set-product-version.mjs` writes it back as `0.0.N`, like the installer, and `scripts/build-speech-helpers.mjs` gives the speech program the same name and version. The beta's product name is *Open Historia Beta*, so the beta is not signed; neither is the native app.
- **Every release approved by hand:** each build makes two signing requests, both waiting for the approver.
- **Privacy:** what the app contacts on its own is in the privacy policy (`public/privacy/`). The Windows installer shows a privacy page (`build/installer.nsh`) that names those things, links the policy, and has a box to switch off each of: update checks, the install count, and the Discord link handler. The answers go to `install-options.json` in the app's data folder; `electron/installOptions.cjs` reads it, and `main.cjs` and `server.js` honour it. Visit counting is already off until the player agrees to it in the game.
- **Announce system changes:** the only change outside the install folder is the Discord link handler, named on the installer's page and switchable there.
- **Uninstallation:** the NSIS installer registers an uninstaller (*Installed apps*); the README says so.
- **Code signing policy:** the *Code signing policy* section of `README.md` (attribution, what is signed, roles, privacy), linked from the website's footer and Windows download text and from every signed release page.
- **No hacking tools, no malware:** none.
- **Multi-factor authentication** on GitHub and SignPath for everyone on the team: the owner's to keep on.

## Owner checklist

1. **Apply** at <https://signpath.org/apply> (SignPath Foundation, free for open source) with the repository `https://github.com/Open-Historia/open-historia`. They check:
   - an OSI-approved license (AGPL-3.0-or-later, `LICENSE`), with no commercial dual licensing;
   - that releases are built from source on **GitHub-hosted runners** by the public repository's workflows (they are: `windows-latest`);
   - a **code signing policy** on the home page and the download page. It is the *Code signing policy* section of `README.md`, and every signed release page links to it;
   - multi-factor authentication on GitHub and SignPath for everyone on the team.
2. **Set up the SignPath project** they create for you:
   - Install the SignPath GitHub App for the repository if they ask (it lets SignPath read the workflow run that made each artifact).
   - Add an artifact configuration and paste in `.signpath/artifact-configuration.xml` (paste it again whenever that file changes). Make it the project's default, or note its slug for step 3.
   - Note the organization id (a GUID, in the organization's settings), the project slug and the signing policy slug. The Foundation's release policy is `release-signing`; it stays *invalid* until the Foundation's certificate request (*CSR pending*) is issued, which the Foundation does, not you. Until then use `test-signing` to try the whole run (its test certificate is not trusted by Windows), then set the variable to `release-signing`.
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
4. **Test it** by dispatching *Desktop installers* with a throwaway tag such as `desktop-signing-test` (an empty tag falls back to `desktop-stable`, which players update from), and delete that release and its `-chunks` release afterwards. Approve the two signing requests in SignPath when they appear. In the run, `Check the Windows signatures` lists each file as `Valid` (with `test-signing`, Windows reports the test certificate as untrusted: that run only proves the wiring).
5. Once a signed build is out, update the install texts that still say the Windows installer is not code-signed: `site/index.html` (the Windows tab), `wiki/start/install.md`, `wiki/reference/troubleshooting.md`. SmartScreen can still warn for the first downloads of a new certificate until it has built a reputation.

## macOS

Still unsigned. The Apple Developer Program would be needed for a Developer ID certificate and notarization; until then the macOS app is ad-hoc signed (`scripts/mac-adhoc-sign.cjs`) and players open it with *Open Anyway*, as the README says.

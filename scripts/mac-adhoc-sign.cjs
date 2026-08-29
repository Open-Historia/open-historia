// electron-builder `afterPack` hook: ad-hoc code-signs the packaged macOS .app.
//
// WHY THIS EXISTS
// ---------------
// Neither desktop workflow has an Apple certificate, so both set
// CSC_IDENTITY_AUTO_DISCOVERY=false and electron-builder skips macOS signing
// entirely. That does NOT leave the app "unsigned" in a way macOS tolerates: the
// prebuilt Electron binary already carries the ad-hoc LINKER signature that every
// arm64 Mach-O must have to execute at all, and shipping the app with only that
// leaves the BUNDLE half-signed —
//
//   Identifier=Electron                    <- the stock binary's id, not ours
//   flags=0x20002(adhoc,linker-signed)
//   Sealed Resources=none                  <- no _CodeSignature/CodeResources
//   Info.plist=not bound
//
// so `codesign --verify` fails with "code has no resources but signature
// indicates they must be present". A quarantined app whose signature is INVALID
// (rather than merely untrusted) is refused by Gatekeeper as "is damaged and
// can't be opened. You should move it to the Trash." — with no right-click →
// Open and no "Open Anyway" in Privacy & Security, because both of those escape
// hatches only exist for apps that are validly signed but not notarized.
//
// Signing the bundle ad-hoc seals the resources and makes the signature valid,
// which puts the download back on that ordinary path. It is NOT a substitute for
// a Developer ID certificate + notarization: testers still get the "Apple cannot
// check it for malicious software" warning, they can just get past it now.
//
// ORDERING NOTE
// -------------
// electron-builder runs afterPack -> electron fuses -> its own signing. Flipping
// a fuse rewrites the binary and would invalidate what we sign here, so if
// `electronFuses` is ever added to a config, this must move (or that config must
// set resetAdHocDarwinSignature). Neither config sets it today.
const path = require('path')

// Ships with electron-builder — it is the same signing engine electron-builder
// uses internally, so this adds no new dependency to install or keep in step.
const { signApp } = require('@electron/osx-sign')

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') {
    console.warn('[mac-adhoc-sign] not running on macOS; leaving the app unsigned')
    return
  }

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`[mac-adhoc-sign] ad-hoc signing ${app}`)

  await signApp({
    app,
    // "-" is codesign's ad-hoc identity. identityValidation must be off or
    // osx-sign looks for it in the keychain and finds nothing.
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    // Fills ElectronTeamID in Info.plist by parsing a team out of the identity
    // name. There is no team in "-", so it has nothing to do but misfire.
    preAutoEntitlements: false,
    // Hardened runtime is a prerequisite for NOTARIZATION, which needs a real
    // certificate we do not have. Enabling it here would only add launch-time
    // restrictions to a build that gains nothing from them.
    optionsForFile: () => ({ hardenedRuntime: false }),
    // osx-sign verifies with `codesign --verify --strict` when it is done, so a
    // seal that did not take fails the build here rather than on a tester's Mac.
    strictVerify: true,
  })

  console.log('[mac-adhoc-sign] done')
}

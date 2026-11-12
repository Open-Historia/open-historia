; Open Historia: the Windows installer's privacy page © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE).
;
; SignPath Foundation, which signs the Windows build, requires software that
; sends anything to systems the player did not choose to say so in a privacy
; policy, show that policy during installation, and offer installation options
; that switch those functions off (docs/code-signing.md). This page does all
; three: it names what the app contacts on its own, links the privacy policy,
; and has a box for each thing a player can do without.
;
; The answers go to install-options.json beside the app's data
; (electron/installOptions.cjs reads it). A silent install (the app updating
; itself) shows no page and leaves the file as the player last set it.
; electron-builder includes this file through nsis.include's default
; (build/installer.nsh) for every Windows installer it makes.

!include nsDialogs.nsh
!include LogicLib.nsh

; Inserted among the installer's pages (assistedInstaller.nsh), after MUI2 is in
; and before the install section that reads these variables.
!macro customPageAfterChangeDir
  Var OHPrivacyDialog
  Var OHCountBox
  Var OHUpdateBox
  Var OHDiscordBox
  Var OHCount
  Var OHUpdate
  Var OHDiscord
  Var OHPrivacyShown

  Function OHPrivacyPageCreate
    !insertmacro MUI_HEADER_TEXT "Privacy" "What the game contacts on its own, and what you can turn off."
    nsDialogs::Create 1018
    Pop $OHPrivacyDialog
    ${If} $OHPrivacyDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 52u "Your games, scenarios and settings stay on this computer. Your AI key and the game's prompts go only to the AI provider you choose. On its own, the game downloads the world map, contacts the community hub when you open it, and does the things below. Visit counting is off unless you agree to it inside the game."
    Pop $0

    ${NSD_CreateCheckbox} 0 56u 100% 12u "Check GitHub for updates when the game opens"
    Pop $OHUpdateBox
    ${NSD_Check} $OHUpdateBox

    ${NSD_CreateCheckbox} 0 70u 100% 12u "Count this install (one download of a small file from GitHub; nothing about you is sent)"
    Pop $OHCountBox
    ${NSD_Check} $OHCountBox

    ${NSD_CreateCheckbox} 0 84u 100% 12u "Let Discord open the game from a friend's invitation (adds a link handler to Windows)"
    Pop $OHDiscordBox
    ${NSD_Check} $OHDiscordBox

    ${NSD_CreateLink} 0 104u 100% 12u "Read the privacy policy: https://openhistoria.com/privacy/"
    Pop $0
    ${NSD_OnClick} $0 OHOpenPrivacyPolicy

    nsDialogs::Show
  FunctionEnd

  Function OHOpenPrivacyPolicy
    ExecShell "open" "https://openhistoria.com/privacy/"
  FunctionEnd

  Function OHPrivacyPageLeave
    StrCpy $OHPrivacyShown "1"
    ${NSD_GetState} $OHUpdateBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $OHUpdate "true"
    ${Else}
      StrCpy $OHUpdate "false"
    ${EndIf}
    ${NSD_GetState} $OHCountBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $OHCount "true"
    ${Else}
      StrCpy $OHCount "false"
    ${EndIf}
    ${NSD_GetState} $OHDiscordBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $OHDiscord "true"
    ${Else}
      StrCpy $OHDiscord "false"
    ${EndIf}
  FunctionEnd

  Page custom OHPrivacyPageCreate OHPrivacyPageLeave
!macroend

!macro customInstall
  ; Where the app keeps its data (Electron's userData): the stable app's is named
  ; after package.json's "name"; the beta and the multiplayer build set their own
  ; name, which is their product name (electron/main.cjs, app.setName).
  !ifndef OH_DATA_DIR
  !if "${PRODUCT_NAME}" == "Open Historia"
    !define OH_DATA_DIR "$APPDATA\open-historia"
  !else
    !define OH_DATA_DIR "$APPDATA\${PRODUCT_NAME}"
  !endif
  !endif
  ${If} $OHPrivacyShown == "1"
    CreateDirectory "${OH_DATA_DIR}"
    FileOpen $0 "${OH_DATA_DIR}\install-options.json" w
    FileWrite $0 '{"checkUpdates":$OHUpdate,"countInstall":$OHCount,"discordLaunch":$OHDiscord}$\r$\n'
    FileClose $0
  ${EndIf}
!macroend

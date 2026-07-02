#!/bin/bash
# Open Historia — macOS launcher © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE).

# macOS double-click wrapper - opens Terminal and runs the launcher.
# (First run: right-click > Open if macOS blocks a downloaded file.)
cd "$(dirname "$0")" && exec bash "./Launch Open Historia.sh"

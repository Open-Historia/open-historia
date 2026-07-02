#!/bin/bash
# macOS double-click wrapper - opens Terminal and runs the updater.
# (First run: right-click > Open if macOS blocks a downloaded file.)
cd "$(dirname "$0")" && exec bash "./Update Open Historia.sh"

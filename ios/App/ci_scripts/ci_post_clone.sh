#!/bin/sh
# Xcode Cloud: install Node, then build the web layer and Capacitor's Swift packages.
set -e
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
brew install node
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci
npx cap sync ios

#!/usr/bin/env bash
set -Eeuo pipefail
APP="${1:?Usage: verify-mac-signing.sh APP_PATH}"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --verify --strict --verbose=2 "$APP/Contents/Resources/server/astronomer-lite"
spctl --assess --type execute --verbose=2 "$APP"
xcrun stapler validate "$APP"

#!/usr/bin/env bash
set -Eeuo pipefail
DMG="${1:?Usage: notarize-mac-installer.sh INSTALLER.dmg}"
: "${APPLE_API_KEY:?Missing notarization key path}"
: "${APPLE_API_KEY_ID:?Missing notarization key ID}"
: "${APPLE_API_ISSUER:?Missing notarization issuer}"
RESULT="$(mktemp)"
trap 'rm -f "$RESULT"' EXIT
xcrun notarytool submit "$DMG" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --output-format json > "$RESULT"
node -e 'const r=JSON.parse(require("node:fs").readFileSync(process.argv[1])); if(r.status!=="Accepted") throw new Error("Installer notarization: " + r.status)' "$RESULT"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
codesign --verify --strict --verbose=2 "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
(cd "$(dirname "$DMG")" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")

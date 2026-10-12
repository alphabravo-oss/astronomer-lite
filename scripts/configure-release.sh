#!/usr/bin/env bash
# Optional one-time GitHub configuration. Secrets are read from environment or
# files and sent on stdin; they are never printed or passed in command arguments.
set -Eeuo pipefail
REPOSITORY=alphabravo-oss/astronomer-lite
for environment in desktop-testing desktop-signing; do
  if ! gh api "repos/$REPOSITORY/environments/$environment" --silent; then
    gh api --method PUT "repos/$REPOSITORY/environments/$environment" --input - --silent <<<'{}'
  fi
done
for name in MAC_CSC_LINK MAC_CSC_KEY_PASSWORD APPLE_API_KEY_BASE64 APPLE_API_KEY_ID APPLE_API_ISSUER AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET RPM_SIGNING_KEY_BASE64 RPM_SIGNING_PASSPHRASE; do
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}" | gh secret set "$name" --repo "$REPOSITORY" --env desktop-signing
  fi
done
for name in AZURE_SIGNING_ENDPOINT AZURE_SIGNING_ACCOUNT AZURE_SIGNING_PROFILE WINDOWS_PUBLISHER_NAME RPM_SIGNING_FINGERPRINT; do
  if [[ -n "${!name:-}" ]]; then
    printf '%s' "${!name}" | gh variable set "$name" --repo "$REPOSITORY" --env desktop-signing
  fi
done
# This does not declare runners ready: configure and check real desktop sessions first.
echo 'Configured release environments and supplied values. Existing unspecified values were preserved.'

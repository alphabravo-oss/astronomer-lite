#!/usr/bin/env bash
# Use an isolated keyring. Never place the private key or passphrase in arguments.
set -Eeuo pipefail
: "${RPM_SIGNING_KEY_BASE64:?Missing signing key}"
: "${RPM_SIGNING_FINGERPRINT:?Missing expected full signing fingerprint}"
: "${RPM_SIGNING_PASSPHRASE:?Missing signing passphrase}"
RPM_FILE="$(realpath "${1:?Usage: sign-linux.sh PACKAGE.rpm}")"
KEY_DIR="$(mktemp -d)"
export GNUPGHOME="$KEY_DIR/gnupg"
mkdir -m 700 "$GNUPGHOME"
trap 'gpgconf --kill gpg-agent || true; rm -rf "$KEY_DIR"' EXIT
printf '%s' "$RPM_SIGNING_KEY_BASE64" | base64 --decode | gpg --batch --import
if [[ ! "$RPM_SIGNING_FINGERPRINT" =~ ^[A-Fa-f0-9]{40}$ ]]; then
  echo 'Use a full 40-character RSA key fingerprint' >&2; exit 1
fi
ACTUAL="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[[ "$ACTUAL" == "${RPM_SIGNING_FINGERPRINT^^}" ]] || { echo 'Signing fingerprint mismatch' >&2; exit 1; }
# RSA/SHA256 signatures remain verifiable on RHEL 8 (avoid newer key algorithms).
ALGORITHM="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "sec" { print $4; exit }')"
[[ "$ALGORITHM" == 1 ]] || { echo 'RHEL signing requires an RSA key' >&2; exit 1; }
cat > "$KEY_DIR/gpg-wrapper" <<'WRAPPER'
#!/usr/bin/env bash
exec gpg --batch --pinentry-mode loopback --passphrase-fd 3 "$@" 3<<<"$RPM_SIGNING_PASSPHRASE"
WRAPPER
chmod 700 "$KEY_DIR/gpg-wrapper"
rpmsign --define "__gpg $KEY_DIR/gpg-wrapper" --define "_gpg_name $RPM_SIGNING_FINGERPRINT" --define '_gpg_digest_algo sha256' --resign "$RPM_FILE"
gpg --batch --armor --export "$RPM_SIGNING_FINGERPRINT" > "${RPM_FILE}.asc"
mkdir "$KEY_DIR/rpmdb"
rpm --dbpath "$KEY_DIR/rpmdb" --import "${RPM_FILE}.asc"
rpmkeys --dbpath "$KEY_DIR/rpmdb" --checksig "$RPM_FILE"
# Authenticate AppImage and DEB as well as the RPM using a signed checksum file.
PREFIX="${RPM_FILE%-linux-x86_64.rpm}"
[[ "$PREFIX" != "$RPM_FILE" ]] || { echo 'Unexpected RPM release filename' >&2; exit 1; }
SUMS="$(dirname "$RPM_FILE")/linux-SHA256SUMS"
(
  cd "$(dirname "$RPM_FILE")"
  sha256sum "$(basename "$PREFIX")-linux-x86_64.AppImage" "$(basename "$PREFIX")-linux-amd64.deb" "$(basename "$RPM_FILE")"
) > "$SUMS"
(cd "$(dirname "$RPM_FILE")" && sha256sum "$(basename "$RPM_FILE")" > "$(basename "$RPM_FILE").sha256")
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --local-user "$RPM_SIGNING_FINGERPRINT" --digest-algo SHA256 --armor --detach-sign "$SUMS" 3<<<"$RPM_SIGNING_PASSPHRASE"
gpg --verify "$SUMS.asc" "$SUMS"
mv "${RPM_FILE}.asc" "$(dirname "$RPM_FILE")/linux-signing-key.asc"

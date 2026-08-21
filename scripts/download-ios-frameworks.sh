#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension xcframeworks for iOS.
#
# Invoked automatically by edgespeech.podspec's `prepare_command` during
# `pod install`, so consumers never run it by hand. Pulls the prebuilt
# xcframeworks (which include the C++ headers EdgeSpeech compiles against) from
# Switchboard's public S3 bucket — we host nothing. The downloaded binaries are
# git-ignored and re-fetched on a clean checkout.
#
# Layout produced (matches the podspec's vendored_frameworks / search paths):
#   ios/Frameworks/<Package>/ios/include/...           (C++ headers)
#   ios/Frameworks/<Package>/ios/<Package>.xcframework (binary)
#
# Whisper is the exception: its zip nests everything under Release/, with an
# extra whisper.xcframework under Release/lib/.
#
# Zip names changed at 3.2.5: <Package>.zip -> <Package>-ios-<version>.zip.
# Layout is unchanged. Check the bucket's naming if a version bump 404s.
#
# Packages don't record their SDK_VERSION, so a marker file tracks it and the
# tree is wiped on mismatch — else a bump leaves checkouts linking old binaries.
set -euo pipefail

SDK_VERSION="3.2.5"
BASE_URL="https://switchboard-sdk-public.s3.amazonaws.com/builds/release/${SDK_VERSION}/ios"

PACKAGES=(SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardWhisper SwitchboardSherpa)

# Where each package's xcframework lands, relative to its own directory. Used
# only to decide whether the package is already present.
xcframework_path() {
  case "$1" in
    SwitchboardWhisper) echo "Release/SwitchboardWhisper.xcframework" ;;
    *) echo "$1.xcframework" ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORKS_DIR="${SCRIPT_DIR}/../ios/Frameworks"
VERSION_MARKER="${FRAMEWORKS_DIR}/.sdk-version"

mkdir -p "${FRAMEWORKS_DIR}"

# No marker => unknown version; treated as a mismatch.
installed_version=""
if [ -f "${VERSION_MARKER}" ]; then
  installed_version="$(cat "${VERSION_MARKER}")"
fi

if [ "${installed_version}" != "${SDK_VERSION}" ]; then
  # Drop first: a failed run below must not look complete.
  rm -f "${VERSION_MARKER}"
  for pkg in "${PACKAGES[@]}"; do
    if [ -d "${FRAMEWORKS_DIR}/${pkg}" ]; then
      echo "↻ ${pkg} is ${installed_version:-an unknown version}, need ${SDK_VERSION} — removing"
      rm -rf "${FRAMEWORKS_DIR:?}/${pkg}"
    fi
  done
fi

for pkg in "${PACKAGES[@]}"; do
  dest="${FRAMEWORKS_DIR}/${pkg}/ios"
  if [ -d "${dest}/$(xcframework_path "${pkg}")" ]; then
    echo "✓ ${pkg} already present — skipping"
    continue
  fi

  echo "↓ Downloading ${pkg} (${SDK_VERSION})"
  mkdir -p "${dest}"
  tmp_zip="${dest}/${pkg}.zip"
  curl -fsSL "${BASE_URL}/${pkg}-ios-${SDK_VERSION}.zip" -o "${tmp_zip}"

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_zip}" -d "${dest}"
  rm -f "${tmp_zip}"
done

# Only after every package succeeded.
printf '%s\n' "${SDK_VERSION}" > "${VERSION_MARKER}"

echo "✓ Switchboard iOS frameworks ready in ios/Frameworks/ (${SDK_VERSION})"

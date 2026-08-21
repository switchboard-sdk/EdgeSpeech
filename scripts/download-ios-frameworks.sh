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
# Note on the zip names: up to 3.2.4 they were <Package>.zip; from 3.2.5 they are
# <Package>-ios-<version>.zip. Only the file names changed — the extracted layout
# above is identical, so the podspec's paths are unaffected. If a version bump
# 404s here, check the naming scheme in the bucket first.
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

mkdir -p "${FRAMEWORKS_DIR}"

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

echo "✓ Switchboard iOS frameworks ready in ios/Frameworks/"

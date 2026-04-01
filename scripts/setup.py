#!/usr/bin/env python3
"""
Setup script for Switchboard SDK frameworks.

Downloads and extracts Switchboard SDK XCFrameworks for iOS development.
Run this script before building the iOS app.

Usage:
    python3 scripts/setup.py [--platform ios|android] [--sdk-version VERSION]
"""

import argparse
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path


# Default SDK version - update this as new versions are released
DEFAULT_SDK_VERSION = "tayyabjaved/v3-example-release-build"  # TODO: Update to stable release version

# Switchboard SDK packages required for voice functionality
IOS_PACKAGES = [
    "SwitchboardSDK",        # Core SDK
    "SwitchboardOnnx",       # ONNX runtime for ML models
    "SwitchboardSileroVAD",  # Voice Activity Detection
    "SwitchboardWhisper",    # Speech-to-Text
    # "SwitchboardSilero",   # Text-to-Speech (uncomment when implementing TTS)
]

ANDROID_PACKAGES = [
    # TODO: Add Android package names when implementing Android support
]


def get_project_root():
    """Get the project root directory using git."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True
        )
        return Path(result.stdout.strip())
    except subprocess.CalledProcessError:
        # Fallback: assume script is in scripts/ directory
        return Path(__file__).parent.parent


def download_and_extract_package(package_name, platform, sdk_version, project_root):
    """Download and extract a single Switchboard SDK package."""

    libs_dir = project_root / "Frameworks" / package_name / platform

    # Clean existing directory
    if libs_dir.exists():
        print(f"Removing existing {package_name}...")
        shutil.rmtree(libs_dir)

    libs_dir.mkdir(parents=True, exist_ok=True)

    # Download
    download_url = f"https://switchboard-sdk-public.s3.amazonaws.com/builds/{sdk_version}/{platform}/{package_name}.zip"
    zip_path = libs_dir / f"{package_name}.zip"

    print(f"Downloading {package_name} from {download_url}...")
    try:
        urllib.request.urlretrieve(download_url, zip_path)
    except Exception as e:
        print(f"Error downloading {package_name}: {e}", file=sys.stderr)
        return False

    # Extract
    print(f"Extracting {package_name}...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(libs_dir)
    except Exception as e:
        print(f"Error extracting {package_name}: {e}", file=sys.stderr)
        return False
    finally:
        # Clean up zip file
        if zip_path.exists():
            zip_path.unlink()

    print(f"✓ {package_name} installed successfully")
    return True


def setup_ios(sdk_version, project_root):
    """Download all iOS Switchboard SDK frameworks."""
    print(f"\n{'='*60}")
    print(f"Setting up Switchboard SDK for iOS")
    print(f"SDK Version: {sdk_version}")
    print(f"Project Root: {project_root}")
    print(f"{'='*60}\n")

    success_count = 0
    for package in IOS_PACKAGES:
        if download_and_extract_package(package, "ios", sdk_version, project_root):
            success_count += 1

    print(f"\n{'='*60}")
    print(f"iOS Setup Complete: {success_count}/{len(IOS_PACKAGES)} packages installed")
    print(f"{'='*60}\n")

    if success_count < len(IOS_PACKAGES):
        print("⚠️  Some packages failed to install. Check errors above.")
        return False

    return True


def setup_android(sdk_version, project_root):
    """Download all Android Switchboard SDK libraries."""
    print("\n⚠️  Android support not yet implemented")
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Download Switchboard SDK frameworks for iOS/Android development"
    )
    parser.add_argument(
        "--platform",
        choices=["ios", "android"],
        default="ios",
        help="Platform to setup (default: ios)"
    )
    parser.add_argument(
        "--sdk-version",
        default=DEFAULT_SDK_VERSION,
        help=f"Switchboard SDK version (default: {DEFAULT_SDK_VERSION})"
    )

    args = parser.parse_args()
    project_root = get_project_root()

    if args.platform == "ios":
        success = setup_ios(args.sdk_version, project_root)
    elif args.platform == "android":
        success = setup_android(args.sdk_version, project_root)
    else:
        print(f"Unknown platform: {args.platform}", file=sys.stderr)
        success = False

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Download Switchboard SDK frameworks for iOS.

This script downloads the required Switchboard SDK XCFrameworks for the
switchboard-voice-rn module. Run this script after installing the npm package.

Usage:
    python3 node_modules/switchboard-voice-rn/scripts/download-sdk.py

Or if you have the repo cloned:
    python3 scripts/download-sdk.py --output ./ios/Frameworks

Requirements:
    Python 3.7+
"""

import argparse
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

# SDK Configuration from https://docs.switchboard.audio/downloads/
DEFAULT_SDK_VERSION = "release/3.1.0"
SDK_BASE_URL = "https://switchboard-sdk-public.s3.amazonaws.com/builds"

# Package definitions with explicit xcframework paths
PACKAGES = {
    "SwitchboardSDK": {
        "xcframeworks": [
            "SwitchboardSDK.xcframework",
        ]
    },
    "SwitchboardOnnx": {
        "xcframeworks": [
            "SwitchboardOnnx.xcframework",
        ]
    },
    "SwitchboardSileroVAD": {
        "xcframeworks": [
            "SwitchboardSileroVAD.xcframework",
        ]
    },
    "SwitchboardWhisper": {
        "xcframeworks": [
            "Release/SwitchboardWhisper.xcframework",
            "Release/lib/libggml-base.xcframework",
            "Release/lib/libggml-blas.xcframework",
            "Release/lib/libggml-cpu.xcframework",
            "Release/lib/libggml.xcframework",
            "Release/lib/libwhisper.xcframework",
            "Release/lib/libwhisper.coreml.xcframework",
        ]
    },
    "SwitchboardSherpa": {
        "xcframeworks": [
            "SwitchboardSherpa.xcframework",
        ]
    },
}

# Default packages for voice functionality (VAD + STT + TTS)
VOICE_PACKAGES = [
    "SwitchboardSDK",
    "SwitchboardOnnx",
    "SwitchboardSileroVAD",
    "SwitchboardWhisper",
    "SwitchboardSherpa",
]


def download_and_extract_package(package_name, sdk_version, output_dir):
    """Download and extract a Switchboard SDK package."""
    if package_name not in PACKAGES:
        print(f"  ERROR: Unknown package '{package_name}'")
        print(f"  Available packages: {', '.join(PACKAGES.keys())}")
        return False

    package_dir = output_dir / package_name / "ios"

    # Clean existing directory
    if package_dir.exists():
        print(f"  Removing existing {package_name}...")
        shutil.rmtree(package_dir)

    package_dir.mkdir(parents=True, exist_ok=True)

    # Download
    download_url = f"{SDK_BASE_URL}/{sdk_version}/ios/{package_name}.zip"
    zip_path = package_dir / f"{package_name}.zip"

    print(f"  Downloading {package_name}...")
    print(f"    URL: {download_url}")
    try:
        urllib.request.urlretrieve(download_url, zip_path)
    except Exception as e:
        print(f"  ERROR downloading {package_name}: {e}")
        return False

    # Extract
    print(f"  Extracting {package_name}...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(package_dir)
    except Exception as e:
        print(f"  ERROR extracting {package_name}: {e}")
        return False
    finally:
        if zip_path.exists():
            zip_path.unlink()

    # Verify expected xcframeworks exist
    expected = PACKAGES[package_name]["xcframeworks"]
    missing = []
    for xcf in expected:
        if not (package_dir / xcf).exists():
            missing.append(xcf)

    if missing:
        print(f"  WARNING: Missing expected xcframeworks in {package_name}:")
        for m in missing:
            print(f"    - {m}")

    print(f"  ✓ {package_name}")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Download Switchboard SDK frameworks for iOS"
    )
    parser.add_argument(
        "--output", "-o",
        help="Output directory for frameworks (default: auto-detect based on project structure)"
    )
    parser.add_argument(
        "--sdk-version",
        default=DEFAULT_SDK_VERSION,
        help=f"SDK version to download (default: {DEFAULT_SDK_VERSION})"
    )
    parser.add_argument(
        "--packages",
        help="Comma-separated list of packages to download (default: voice packages)"
    )
    parser.add_argument(
        "--list-packages",
        action="store_true",
        help="List available packages and exit"
    )

    args = parser.parse_args()

    if args.list_packages:
        print("Available packages:")
        for name, info in PACKAGES.items():
            print(f"  {name}")
            for xcf in info["xcframeworks"]:
                print(f"    - {xcf}")
        return 0

    # Determine output directory
    if args.output:
        output_dir = Path(args.output)
    else:
        # Try to auto-detect based on common project structures
        script_dir = Path(__file__).parent

        # Check if we're in node_modules (customer project)
        if "node_modules" in str(script_dir):
            # Find project root (parent of node_modules)
            parts = script_dir.parts
            nm_idx = parts.index("node_modules")
            project_root = Path(*parts[:nm_idx])

            # Look for Expo module structure
            expo_module_path = project_root / "modules" / "switchboard-voice" / "ios" / "Frameworks"
            if (project_root / "modules" / "switchboard-voice").exists():
                output_dir = expo_module_path
            else:
                # Default to ios/Frameworks in project root
                output_dir = project_root / "ios" / "Frameworks"
        else:
            # We're in the source repo
            repo_root = script_dir.parent
            output_dir = repo_root / "example" / "modules" / "switchboard-voice" / "ios" / "Frameworks"

    # Determine packages to download
    if args.packages:
        package_list = [p.strip() for p in args.packages.split(",")]
    else:
        package_list = VOICE_PACKAGES

    print(f"\n{'='*60}")
    print("Downloading Switchboard SDK Frameworks")
    print(f"{'='*60}")
    print(f"SDK Version: {args.sdk_version}")
    print(f"Output: {output_dir}")
    print(f"Packages: {', '.join(package_list)}")
    print(f"{'='*60}\n")

    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for package in package_list:
        if download_and_extract_package(package, args.sdk_version, output_dir):
            success_count += 1

    print(f"\n{'='*60}")
    print(f"Download Complete: {success_count}/{len(package_list)} packages")
    print(f"{'='*60}\n")

    if success_count < len(package_list):
        print("ERROR: Some packages failed to download")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

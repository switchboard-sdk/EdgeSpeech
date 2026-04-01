"""
Invoke tasks for Switchboard Voice React Native module.

Usage:
    inv setup          # Full setup (download SDK, npm install, pod install)
    inv download-sdk   # Download Switchboard SDK frameworks only
    inv setup-ios      # Run pod install only
    inv setup-npm      # Run npm install only
    inv clean          # Remove downloaded frameworks and build artifacts

Requirements:
    pip install invoke
"""

import shutil
import urllib.request
import zipfile
from pathlib import Path

from invoke import task

# SDK Configuration from https://docs.switchboard.audio/downloads/
DEFAULT_SDK_VERSION = "release/3.1.0"
SDK_BASE_URL = "https://switchboard-sdk-public.s3.amazonaws.com/builds"

# Package definitions with explicit xcframework paths
# Each package defines the xcframeworks it contains after extraction
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


def get_project_root():
    """Get the project root directory."""
    return Path(__file__).parent


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


@task
def download_sdk(ctx, output=None, sdk_version=None, packages=None):
    """
    Download Switchboard SDK frameworks.

    Examples:
        inv download-sdk
        inv download-sdk --packages=SwitchboardSDK,SwitchboardWhisper
        inv download-sdk --output=/path/to/Frameworks
        inv download-sdk --sdk-version=release/3.0.0
    """
    project_root = get_project_root()
    sdk_version = sdk_version or DEFAULT_SDK_VERSION

    if output:
        output_dir = Path(output)
    else:
        # Default: download to ios/Frameworks at project root
        output_dir = project_root / "ios" / "Frameworks"

    if packages:
        package_list = [p.strip() for p in packages.split(",")]
    else:
        package_list = VOICE_PACKAGES

    print(f"\n{'='*60}")
    print("Downloading Switchboard SDK Frameworks")
    print(f"{'='*60}")
    print(f"SDK Version: {sdk_version}")
    print(f"Output: {output_dir}")
    print(f"Packages: {', '.join(package_list)}")
    print(f"{'='*60}\n")

    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0
    for package in package_list:
        if download_and_extract_package(package, sdk_version, output_dir):
            success_count += 1

    print(f"\n{'='*60}")
    print(f"Download Complete: {success_count}/{len(package_list)} packages")
    print(f"{'='*60}\n")

    if success_count < len(package_list):
        raise Exception("Some packages failed to download")


@task
def setup_npm(ctx, directory=None):
    """
    Run npm install.

    Examples:
        inv setup-npm
        inv setup-npm --directory=/path/to/app
    """
    project_root = get_project_root()

    if directory:
        npm_dir = Path(directory)
    else:
        npm_dir = project_root / "example"

    print(f"\n{'='*60}")
    print("Installing npm dependencies")
    print(f"Directory: {npm_dir}")
    print(f"{'='*60}\n")

    with ctx.cd(str(npm_dir)):
        ctx.run("npm install", pty=True)

    print("\n✓ npm install complete\n")


@task
def setup_ios(ctx, directory=None):
    """
    Run pod install for iOS.

    Examples:
        inv setup-ios
        inv setup-ios --directory=/path/to/ios
    """
    project_root = get_project_root()

    if directory:
        ios_dir = Path(directory)
    else:
        ios_dir = project_root / "example" / "ios"

    print(f"\n{'='*60}")
    print("Installing CocoaPods dependencies")
    print(f"Directory: {ios_dir}")
    print(f"{'='*60}\n")

    with ctx.cd(str(ios_dir)):
        ctx.run("pod install", pty=True)

    print("\n✓ pod install complete\n")


@task
def clean(ctx):
    """Remove downloaded frameworks and build artifacts."""
    project_root = get_project_root()

    paths_to_clean = [
        project_root / "ios" / "Frameworks",
        project_root / "example" / "ios" / "Pods",
        project_root / "example" / "ios" / "build",
        project_root / "example" / "node_modules",
        project_root / "Frameworks",  # Legacy location
    ]

    print(f"\n{'='*60}")
    print("Cleaning build artifacts")
    print(f"{'='*60}\n")

    for path in paths_to_clean:
        if path.exists():
            print(f"  Removing {path.relative_to(project_root)}...")
            shutil.rmtree(path)

    print("\n✓ Clean complete\n")


@task(pre=[download_sdk, setup_npm, setup_ios])
def setup(ctx):
    """
    Full setup: download SDK, npm install, pod install.

    Run this after cloning the repo to set up everything needed to build.
    """
    print(f"\n{'='*60}")
    print("Setup Complete!")
    print(f"{'='*60}")
    print("\nYou can now build the example app:")
    print("  cd example")
    print("  npx expo run:ios")
    print(f"{'='*60}\n")

#!/usr/bin/env bash
# Build the trimmed ffmpeg/ffprobe sidecars in WSL Ubuntu.
#
# Docker is the portable path (see Dockerfile); this is the no-Docker path.
# Everything happens in WSL's native filesystem — building on /mnt/c is
# dramatically slower because of the 9p mount — and only the two finished
# binaries are copied back to the Windows side.
#
# Usage:  wsl -d Ubuntu -- bash /mnt/c/.../scripts/ffmpeg/wsl-build.sh <win-repo-path>
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-7.1}"
REPO="${1:?usage: wsl-build.sh <path-to-repo-under-/mnt>}"
DEST="$REPO/src-tauri/binaries"
WORK=/tmp/ffbuild
SRC="$WORK/ffmpeg-$FFMPEG_VERSION"

echo "==> Installing toolchain"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mingw-w64 build-essential curl xz-utils pkg-config yasm nasm

echo "==> Fetching ffmpeg $FFMPEG_VERSION"
mkdir -p "$WORK"
if [ ! -d "$SRC" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" | tar -xJ -C "$WORK"
fi

echo "==> Building"
cd "$SRC"
OUT="$WORK/out" bash "$REPO/scripts/ffmpeg/build.sh"

echo "==> Copying sidecars to $DEST"
mkdir -p "$DEST"
cp "$WORK/out/ffmpeg.exe"  "$DEST/ffmpeg-x86_64-pc-windows-msvc.exe"
cp "$WORK/out/ffprobe.exe" "$DEST/ffprobe-x86_64-pc-windows-msvc.exe"
ls -la "$DEST"

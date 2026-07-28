# Portable path for building the trimmed LGPL ffmpeg sidecars.
# The no-Docker equivalent is wsl-build.sh; both share build.sh so the
# configure flags are defined once.
#
#   docker build -t shpeegle-ffmpeg scripts/ffmpeg/
#   docker run --rm -v "$(pwd)/src-tauri/binaries:/out" shpeegle-ffmpeg
#
# Outputs ffmpeg.exe and ffprobe.exe into /out; rename them with the
# x86_64-pc-windows-msvc suffix Tauri's externalBin expects.
FROM debian:bookworm

RUN apt-get update && apt-get install -y \
      mingw-w64 build-essential curl xz-utils pkg-config yasm nasm \
    && rm -rf /var/lib/apt/lists/*

ARG FFMPEG_VERSION=7.1
RUN curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
      | tar -xJ -C /tmp
WORKDIR /tmp/ffmpeg-${FFMPEG_VERSION}

COPY build.sh /build.sh
RUN chmod +x /build.sh
CMD ["/build.sh"]

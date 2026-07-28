#!/usr/bin/env bash
# Configure + build a trimmed, audio-only, LGPL ffmpeg/ffprobe for Windows.
#
# Run from inside an unpacked ffmpeg source tree. Used by both the Dockerfile
# and wsl-build.sh, so the configure flags live in exactly one place.
#
# Three things that --disable-everything silently takes away, each of which
# produces a baffling runtime error rather than a build failure:
#   1. muxers/encoders/protocols — `-f f32le -` to stdout needs f32le + pcm_f32le + pipe
#   2. filters — `-ar`/`-ac` conversion runs through aresample in avfilter
#   3. demuxers — enabled separately from decoders; a container without its
#      demuxer yields "Invalid data found when processing input"
set -euo pipefail

OUT="${OUT:-/out}"

DECODERS=ape,dsd_lsbf,dsd_lsbf_planar,dsd_msbf,dsd_msbf_planar,mpc7,mpc8
DECODERS=$DECODERS,tta,wavpack,wmav1,wmav2,wmapro,wmalossless,opus,vorbis
DECODERS=$DECODERS,flac,mp3,aac,alac
DECODERS=$DECODERS,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8
DECODERS=$DECODERS,pcm_s16be,pcm_s24be,pcm_s32be

DEMUXERS=ape,dsf,iff,mpc,mpc8,tta,wv,asf,ogg,matroska,mov,mp3,flac,wav,aiff,caf,aac,w64

PARSERS=ape,flac,mpegaudio,opus,vorbis,aac

# configure only *warns* on an unrecognised --enable-* name and builds anyway,
# which yields a binary that is missing a feature you believe you asked for.
# Capture the log and treat any such warning as fatal.
#
# The name trap that cost us a rebuild: configure derives option names from the
# C symbol (ff_pcm_f32le_muxer -> "pcm_f32le"), while the runtime `-f` flag uses
# the format's .name field ("f32le"). They are NOT the same string.
run_configure() {
  ./configure "$@" 2>&1 | tee /tmp/ffconfigure.log
  if grep -q "did not match anything" /tmp/ffconfigure.log; then
    echo >&2
    echo "FATAL: configure ignored an option:" >&2
    grep "did not match anything" /tmp/ffconfigure.log >&2
    exit 1
  fi
}

run_configure \
  --target-os=mingw32 \
  --arch=x86_64 \
  --cross-prefix=x86_64-w64-mingw32- \
  --prefix="$OUT" \
  --disable-everything \
  --disable-gpl --disable-nonfree --enable-version3 \
  --disable-doc --disable-debug \
  --disable-avdevice --disable-swscale --disable-postproc \
  --disable-network --disable-iconv --disable-sdl2 --disable-zlib --disable-bzlib \
  --disable-lzma --disable-schannel \
  --enable-swresample --enable-avfilter \
  --enable-filter=aresample,aformat,anull,atrim,aselect,volume \
  --enable-decoder="$DECODERS" \
  --enable-demuxer="$DEMUXERS" \
  --enable-encoder=pcm_f32le \
  --enable-muxer=pcm_f32le \
  --enable-protocol=file,pipe \
  --enable-parser="$PARSERS" \
  --enable-small

make -j"$(nproc)"

mkdir -p "$OUT"
cp ffmpeg.exe ffprobe.exe "$OUT"/
x86_64-w64-mingw32-strip "$OUT/ffmpeg.exe" "$OUT/ffprobe.exe"
ls -la "$OUT"/

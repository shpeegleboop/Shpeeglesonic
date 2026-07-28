#!/usr/bin/env bash
# Prove the trimmed build actually has the codecs, demuxers, muxers and
# encoders the app depends on. Building successfully is not evidence of this:
# --disable-everything drops pieces silently and the failure only shows up at
# playback time.
#
# Run from the repo root:  bash scripts/ffmpeg/verify.sh
set -uo pipefail

BIN="${BIN:-src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe}"
fail=0

if [ ! -f "$BIN" ]; then
  echo "missing binary: $BIN" >&2
  exit 1
fi

# ffmpeg lists several formats under compound names ("matroska,webm",
# "mov,mp4,m4a,3gp,3g2,mj2"), so match against the comma-split name field
# rather than the raw line.
#
# Note these are RUNTIME names, which differ from the configure-time option
# names in build.sh — the raw PCM muxer is `pcm_f32le` to configure and
# `f32le` to `-f`.
check() { # $1 = list flag (decoders/demuxers/muxers/encoders), $2 = name
  if "$BIN" -hide_banner "-$1" 2>/dev/null \
       | awk '{print $2}' | tr ',' '\n' | grep -qx "$2"; then
    printf 'ok    %-9s %s\n' "$1" "$2"
  else
    printf 'MISS  %-9s %s\n' "$1" "$2"
    fail=1
  fi
}

for d in ape dsd_msbf dsd_lsbf mpc7 mpc8 tta wavpack wmav2 opus flac mp3 alac aac; do
  check decoders "$d"
done

for m in ape dsf iff mpc tta wv asf ogg matroska mov flac wav aiff caf; do
  check demuxers "$m"
done

check muxers   f32le
check encoders pcm_f32le

# The lists above prove the pieces exist. This proves they compose — it is the
# exact invocation open_stream() makes, and it is what actually broke when the
# muxer name was wrong while every individual check still passed.
SAMPLE="${SAMPLE:-src-tauri/tests/fixtures/tone.aiff}"
if [ -f "$SAMPLE" ]; then
  bytes=$("$BIN" -hide_banner -i "$SAMPLE" \
            -f f32le -acodec pcm_f32le -ar 44100 -ac 2 -v error - 2>/dev/null | wc -c)
  # tone.aiff is 0.5s stereo -> 44100 * 0.5 * 2ch * 4 bytes = 176400
  if [ "$bytes" -gt 100000 ]; then
    printf 'ok    %-9s %s bytes of f32le PCM\n' pipeline "$bytes"
  else
    printf 'MISS  %-9s produced only %s bytes\n' pipeline "$bytes"
    fail=1
  fi
else
  echo "skip  pipeline  (no sample at $SAMPLE)"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "One or more capabilities are missing — add them to build.sh and rebuild." >&2
fi
exit $fail

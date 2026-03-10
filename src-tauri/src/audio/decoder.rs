use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Decoded audio data: interleaved f32 samples, sample rate, and channel count.
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Quick file probe — returns (sample_rate, channels, duration_seconds, bit_depth, bitrate)
/// without decoding any audio data.
pub fn probe_file_info(
    path: &str,
) -> Result<(u32, u16, f64, Option<u32>, Option<u32>), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe format: {}", e))?;

    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let params = &track.codec_params;
    let sample_rate = params.sample_rate.ok_or("Unknown sample rate")?;
    let channels = params.channels.map(|c| c.count() as u16).unwrap_or(2);

    let duration_seconds = params
        .n_frames
        .map(|n| n as f64 / sample_rate as f64)
        .unwrap_or(0.0);

    let bit_depth = params.bits_per_sample.map(|b| b as u32);
    let bitrate = None; // Not reliably available from codec params

    Ok((sample_rate, channels, duration_seconds, bit_depth, bitrate))
}

/// Open a file and return the format reader, decoder, track_id, sample_rate, channels.
/// Used by the streaming decode thread.
pub fn open_for_streaming(
    path: &str,
) -> Result<
    (
        Box<dyn symphonia::core::formats::FormatReader>,
        Box<dyn symphonia::core::codecs::Decoder>,
        u32, // track_id
        u32, // sample_rate
        u16, // channels
    ),
    String,
> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Failed to probe format: {}", e))?;

    let format_reader = probed.format;

    let track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let sample_rate = codec_params.sample_rate.ok_or("Unknown sample rate")?;
    let channels = codec_params
        .channels
        .map(|c| c.count() as u16)
        .unwrap_or(2);

    let decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    Ok((format_reader, decoder, track_id, sample_rate, channels))
}

/// Decode an audio file at the given path into interleaved f32 PCM samples.
/// Used as fallback when resampling is needed.
pub fn decode_file(path: &str) -> Result<DecodedAudio, String> {
    let (mut format_reader, mut decoder, track_id, sample_rate, channels) =
        open_for_streaming(path)?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format_reader.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(format!("Error reading packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(symphonia::core::errors::Error::DecodeError(e)) => {
                eprintln!("Decode error (skipping packet): {}", e);
                continue;
            }
            Err(e) => return Err(format!("Fatal decode error: {}", e)),
        };

        append_samples(&decoded, &mut all_samples, channels);
    }

    Ok(DecodedAudio {
        samples: all_samples,
        sample_rate,
        channels,
    })
}

/// Convert an AudioBufferRef to interleaved f32 samples and append to output.
pub fn append_samples(buf: &AudioBufferRef, output: &mut Vec<f32>, channels: u16) {
    let ch = channels as usize;
    match buf {
        AudioBufferRef::F32(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    output.push(*b.chan(c).get(frame).unwrap_or(&0.0));
                }
            }
        }
        AudioBufferRef::S32(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&0);
                    output.push(sample as f32 / 2147483648.0);
                }
            }
        }
        AudioBufferRef::S16(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&0);
                    output.push(sample as f32 / 32768.0);
                }
            }
        }
        AudioBufferRef::U8(b) => {
            let frames = b.frames();
            output.reserve(frames * ch);
            for frame in 0..frames {
                for c in 0..ch {
                    let sample = *b.chan(c).get(frame).unwrap_or(&128);
                    output.push((sample as f32 - 128.0) / 128.0);
                }
            }
        }
        _ => {
            eprintln!("Unsupported sample format, skipping buffer");
        }
    }
}

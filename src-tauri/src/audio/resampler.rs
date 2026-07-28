use rubato::{Fft, FixedSync, Resampler};


/// A streaming resampler that processes chunks incrementally.
/// Call `process_chunk` with interleaved input samples, get interleaved output samples back.
pub struct StreamingResampler {
    resampler: Fft<f32>,
    channels: usize,
    chunk_size: usize,
    // Buffers for de-interleaved input per channel
    input_buffers: Vec<Vec<f32>>,
    // Buffers for de-interleaved output per channel
    output_buffers: Vec<Vec<f32>>,
}

impl StreamingResampler {
    pub fn new(from_rate: u32, to_rate: u32, channels: u16) -> Result<Self, String> {
        let ch = channels as usize;
        let chunk_size = 1024;

        let resampler = Fft::<f32>::new(
            from_rate as usize,
            to_rate as usize,
            chunk_size,
            2,
            ch,
            FixedSync::Input,
        )
        .map_err(|e| format!("Failed to create streaming resampler: {}", e))?;

        let max_out = resampler.output_frames_max();

        Ok(StreamingResampler {
            resampler,
            channels: ch,
            chunk_size,
            input_buffers: vec![vec![0.0f32; chunk_size]; ch],
            output_buffers: vec![vec![0.0f32; max_out]; ch],
        })
    }

    /// Process a chunk of interleaved input samples and return interleaved resampled output.
    /// Input must contain exactly `chunk_size` frames (chunk_size * channels samples).
    /// Returns None if the chunk was too small (needs more data).
    pub fn process_chunk(&mut self, interleaved_input: &[f32]) -> Result<Vec<f32>, String> {
        let ch = self.channels;
        let frames = interleaved_input.len() / ch;

        // De-interleave into input_buffers
        for c in 0..ch {
            self.input_buffers[c].resize(frames, 0.0);
        }
        for frame in 0..frames {
            for c in 0..ch {
                self.input_buffers[c][frame] = interleaved_input[frame * ch + c];
            }
        }

        // Ensure output buffers are big enough
        let max_out = self.resampler.output_frames_max();
        for c in 0..ch {
            self.output_buffers[c].resize(max_out, 0.0);
        }

        // Create adapters
        let input_adapter =
            audioadapter_buffers::direct::SequentialSliceOfVecs::new(&self.input_buffers, ch, frames)
                .map_err(|e| format!("Input adapter error: {}", e))?;
        let mut output_adapter =
            audioadapter_buffers::direct::SequentialSliceOfVecs::new_mut(&mut self.output_buffers, ch, max_out)
                .map_err(|e| format!("Output adapter error: {}", e))?;

        let (_in_used, out_written) = self.resampler
            .process_into_buffer(&input_adapter, &mut output_adapter, None)
            .map_err(|e| format!("Resample chunk error: {}", e))?;

        // Re-interleave output
        let mut output = Vec::with_capacity(out_written * ch);
        for frame in 0..out_written {
            for c in 0..ch {
                output.push(self.output_buffers[c][frame]);
            }
        }

        Ok(output)
    }

    /// Returns the number of input frames the resampler expects per chunk.
    pub fn input_chunk_size(&self) -> usize {
        self.chunk_size
    }
}

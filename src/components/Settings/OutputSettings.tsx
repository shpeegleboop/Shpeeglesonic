import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../../stores/playerStore';

interface OutputDevice {
  id: string;
  name: string;
  is_default: boolean;
}

interface OutputStatus {
  sample_rate: number;
  channels: number;
  bit_depth: number | null;
  exclusive: boolean;
  resampling: boolean;
  file_sample_rate: number | null;
  exclusive_requested: boolean;
}

const khz = (hz: number) => `${(hz / 1000).toFixed(1).replace(/\.0$/, '')} kHz`;

/**
 * Output device and share mode.
 *
 * The readout matters as much as the controls: exclusive mode can silently
 * decline (device busy, format refused) and fall back to shared, so the panel
 * reports what the stream is actually doing rather than what was asked for.
 */
export function OutputSettings() {
  const exclusive = usePlayerStore((s) => s.outputExclusive);
  const deviceId = usePlayerStore((s) => s.outputDeviceId);
  const setOutputConfig = usePlayerStore((s) => s.setOutputConfig);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [status, setStatus] = useState<OutputStatus | null>(null);

  useEffect(() => {
    invoke<OutputDevice[]>('list_output_devices')
      .then(setDevices)
      .catch((e) => console.error('Failed to list output devices:', e));
  }, []);

  // The status only changes when a track is loaded, so this follows track
  // changes rather than polling. The delay covers the gap between play_file
  // returning and the output actually being open.
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      invoke<OutputStatus>('get_output_status')
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {});
    read();
    const t = window.setTimeout(read, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [currentTrack?.file_path, isPlaying, exclusive, deviceId]);

  const apply = (nextExclusive: boolean, nextDevice: string | null) => {
    setOutputConfig(nextExclusive, nextDevice);
    invoke('set_output_config', {
      exclusive: nextExclusive,
      deviceId: nextDevice,
    }).catch((e) => console.error('Failed to set output config:', e));
  };

  // Asked for exclusive but running shared — the fallback fired.
  const declined = status?.exclusive_requested === true && status?.exclusive === false;

  return (
    <section className="glass-panel p-4 space-y-4">
      <h2 className="text-lg font-semibold">Audio Output</h2>

      <div>
        <label className="text-sm text-gray-400 block mb-1">Device</label>
        <select
          value={deviceId ?? ''}
          onChange={(e) => apply(exclusive, e.target.value || null)}
          className="w-full bg-cosmic-bg/60 border border-cosmic-border/40 rounded-md text-sm text-gray-300 py-1.5 px-2 focus:outline-none focus:border-neon-purple/40"
        >
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.is_default ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={exclusive}
            onChange={(e) => apply(e.target.checked, deviceId)}
            className="mt-0.5 accent-neon-purple"
          />
          <span>
            <span className="text-sm text-gray-200">Windows Exclusive Mode</span>
            <span className="block text-[11px] text-gray-500 leading-relaxed mt-0.5">
              Takes sole control of the device and plays each file at its own sample rate,
              bypassing the Windows mixer and its resampling. Nothing else on the system can
              make a sound while a track is playing — no notifications, no browser audio.
              Takes effect on the next track.
            </span>
          </span>
        </label>
      </div>

      <div className="bg-black/25 border border-cosmic-border/30 rounded-md px-3 py-2">
        <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
          Actual output
        </div>
        {status ? (
          <>
            <div className="font-mono text-sm text-neon-purple">
              {khz(status.sample_rate)}
              {status.bit_depth ? ` · ${status.bit_depth}-bit` : ''}
              {status.channels ? ` · ${status.channels} ch` : ''}
              <span className="text-gray-500"> · {status.exclusive ? 'exclusive' : 'shared'}</span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              {status.file_sample_rate
                ? // DSD is 1-bit at megahertz rates and no DAC accepts it as PCM,
                  // so it is always decoded. Calling that "converting" reads as a
                  // fault when it is simply what DSD playback is.
                  status.file_sample_rate > 192000
                  ? `DSD ${khz(status.file_sample_rate)} decoded to PCM. Native DSD needs ASIO or DoP; every player converts it.`
                  : status.resampling
                    ? `Converting from ${khz(status.file_sample_rate)} — the device is not running at the file's rate.`
                    : `Matching the file's ${khz(status.file_sample_rate)} — no conversion.`
                : 'Nothing playing yet.'}
            </div>
            {declined && (
              <div className="text-[11px] text-amber-400/90 mt-1">
                Exclusive mode was requested but the device declined it, so this track fell back
                to shared. Another app may be holding the device.
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-600">—</div>
        )}
      </div>
    </section>
  );
}

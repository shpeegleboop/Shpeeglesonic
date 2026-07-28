import { useRef, useEffect, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useFFTData } from '../../hooks/useFFTData';
import { Spectrogram } from './Spectrogram';
import { RadialSpiral } from './RadialSpiral';
import { RotatingSpiral } from './RotatingSpiral';
import { MandelbrotGL } from './MandelbrotGL';
import { Buddhabrot } from './Buddhabrot';
import { Fireworks } from './Fireworks';
import { MusicNotes } from './MusicNotes';
import { CombinedVisualizer } from './CombinedVisualizer';
import { BangerDetector } from './BangerDetector';
import { StereoScope } from './StereoScope';
import { VisualizerQuickSettings } from './VisualizerQuickSettings';
import { VISUALIZER_MODES } from '../../stores/playerStore';

interface VisualizerContainerProps {
  inline?: boolean;
}

export function VisualizerContainer({ inline }: VisualizerContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 200 });
  const mode = usePlayerStore((s) => s.visualizerMode);
  const fullscreen = usePlayerStore((s) => s.visualizerFullscreen);

  // Hide the cursor and the gear after a few seconds of stillness in
  // fullscreen, so a visualizer left running is just the visualizer.
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);

  // Hidden at the OS level, not just in CSS.
  //
  // Two CSS attempts each worked on a different, shifting subset of
  // visualizers — which means the mode was never the variable. Browsers only
  // re-evaluate the cursor on a pointer event, and stillness is exactly what
  // triggers the hide, so whether a CSS change ever took effect came down to
  // whether something happened to force a hit-test refresh. setCursorVisible
  // goes through the window itself and does not depend on that at all.
  //
  // The CSS class stays as a fallback for the case where the permission is
  // unavailable. Both are cleared on exit and on unmount — a cursor left
  // hidden would make the whole app unusable.
  useEffect(() => {
    const root = document.documentElement;
    const hide = fullscreen && idle;
    if (hide) root.classList.add('hide-cursor');
    else root.classList.remove('hide-cursor');

    let cancelled = false;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (!cancelled) getCurrentWindow().setCursorVisible(!hide).catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      root.classList.remove('hide-cursor');
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setCursorVisible(true).catch(() => {}))
        .catch(() => {});
    };
  }, [fullscreen, idle]);

  useEffect(() => {
    if (!fullscreen) {
      idleRef.current = false;
      setIdle(false);
      return;
    }
    let timer = 0;
    const arm = () => {
      // Guarded by a ref so a mousemove only triggers a render when it actually
      // changes something — this fires continuously and the visualizer beneath
      // it is frame-rate sensitive.
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
      }
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        idleRef.current = true;
        setIdle(true);
      }, 3000);
    };
    arm();
    const events = ['mousemove', 'mousedown', 'wheel', 'keydown'] as const;
    events.forEach((ev) => window.addEventListener(ev, arm));
    return () => {
      clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, arm));
    };
  }, [fullscreen]);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);
  const { fftRef, lastUpdateRef } = useFFTData();

  // A callback ref, not a mount-time effect: containerRef points at a
  // different DOM node in each branch (windowed, fullscreen overlay, dormant),
  // so toggling fullscreen remounts the div. With an effect keyed on [] the
  // observer stayed attached to the old, detached node and `size` never
  // updated again — leaving the canvas at the wrong internal resolution and
  // the picture soft.
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = (el: HTMLDivElement | null) => {
    containerRef.current = el;
    observerRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize((prev) => {
            const w = Math.floor(width);
            const h = Math.floor(height);
            return prev.width === w && prev.height === h ? prev : { width: w, height: h };
          });
        }
      }
    });
    ro.observe(el);
    observerRef.current = ro;
  };

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const renderVisualizer = () => {
    // Canvas visualizers render at a quality-scaled internal resolution and
    // stretch to fill — a huge win on weak GPUs, invisible on strong ones.
    // (Mandelbrot manages its own pixel density from the CSS size.)
    const scale = mode === 'mandelbrot' ? 1 : quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
    const props = {
      fftRef,
      lastUpdateRef,
      width: Math.max(64, Math.floor(size.width * scale)),
      height: Math.max(64, Math.floor(size.height * scale)),
    };

    switch (mode) {
      case 'spectrogram':
        return <Spectrogram {...props} />;
      case 'spiral':
        return <RadialSpiral {...props} />;
      case 'rotator':
        return <RotatingSpiral {...props} />;
      case 'mandelbrot':
        return <MandelbrotGL {...props} />;
      case 'buddhabrot':
        return <Buddhabrot {...props} />;
      case 'fireworks':
        return <Fireworks {...props} />;
      case 'notes':
        return <MusicNotes {...props} />;
      case 'combined':
        return <CombinedVisualizer {...props} />;
      case 'banger':
        return <BangerDetector {...props} />;
      case 'scope':
        return <StereoScope {...props} />;
      default:
        return <Spectrogram {...props} />;
    }
  };

  // While the fullscreen overlay owns rendering, inline instances go dormant —
  // otherwise a second full-res visualizer keeps animating underneath it.
  if (fullscreen && inline) {
    return <div className="w-full h-full" />;
  }

  if (fullscreen && !inline) {
    return (
      <div
        className="fixed inset-0 z-50 bg-cosmic-bg"
        style={{ cursor: idle ? 'none' : 'pointer' }}
        onClick={() => usePlayerStore.getState().setVisualizerFullscreen(false)}
      >
        <div ref={measureRef} className="w-full h-full">
          {renderVisualizer()}
        </div>

        {/* Browsers only re-evaluate the cursor image on a pointer event, so
            restyling the overlay while the mouse sits perfectly still — the
            exact case that makes us idle — leaves the old cursor on screen.
            Mounting a fresh element under the pointer changes the hit target
            and forces the recompute. Clicks still bubble to the overlay, so
            click-to-exit is unaffected. */}
        {idle && <div className="absolute inset-0 z-40" style={{ cursor: 'none' }} />}

        <VisualizerQuickSettings hidden={idle} />

        {/* Subtle controls overlay on hover. Non-interactive while idle: the
            webview re-asserts a cursor for whatever interactive element sits
            under the pointer, which undoes the window-level hide — so over
            these controls the cursor stayed visible while it vanished over
            plain canvas. Faded-out controls should not be hoverable regardless. */}
        <div
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity bg-cosmic-panel/80 backdrop-blur-md rounded-lg px-4 py-2 flex items-center gap-4 ${
            idle ? 'pointer-events-none' : ''
          }`}
        >
          <span className="text-xs text-gray-400">ESC to exit</span>
          <div className="flex gap-1">
            {VISUALIZER_MODES.map((m) => (
              <button
                key={m.id}
                onClick={(e) => {
                  e.stopPropagation();
                  usePlayerStore.getState().setVisualizerMode(m.id);
                }}
                className={`px-2 py-0.5 text-xs rounded ${
                  mode === m.id ? 'bg-neon-purple/30 text-neon-purple' : 'text-gray-500 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={measureRef} className="w-full h-full bg-cosmic-bg rounded-lg overflow-hidden">
        {renderVisualizer()}
      </div>
      <VisualizerQuickSettings />
    </div>
  );
}

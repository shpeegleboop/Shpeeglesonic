interface IconProps {
  size?: number;
  className?: string;
}

function icon(path: React.ReactNode, filled = false) {
  return function Icon({ size = 16, className = '' }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={filled ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const PlayIcon = icon(<path d="M7 4.5c0-.9.97-1.45 1.74-.98l12 7.5a1.15 1.15 0 0 1 0 1.96l-12 7.5A1.15 1.15 0 0 1 7 19.5v-15Z" />, true);

export const PauseIcon = icon(
  <>
    <rect x="6" y="4" width="4" height="16" rx="1.2" />
    <rect x="14" y="4" width="4" height="16" rx="1.2" />
  </>,
  true
);

export const PrevIcon = icon(
  <>
    <rect x="4" y="5" width="2.5" height="14" rx="1" />
    <path d="M20 5.85v12.3c0 .93-1.02 1.5-1.8 1L8.9 13c-.74-.48-.74-1.55 0-2.03l9.3-6.13c.78-.5 1.8.07 1.8 1Z" />
  </>,
  true
);

export const NextIcon = icon(
  <>
    <rect x="17.5" y="5" width="2.5" height="14" rx="1" />
    <path d="M4 5.85v12.3c0 .93 1.02 1.5 1.8 1L15.1 13c.74-.48.74-1.55 0-2.03L5.8 4.85c-.78-.5-1.8.07-1.8 1Z" />
  </>,
  true
);

export const ShuffleIcon = icon(
  <>
    <path d="M2 18h2.6a5 5 0 0 0 4.1-2.14L13.3 8.14A5 5 0 0 1 17.4 6H22" />
    <path d="m19 3 3 3-3 3" />
    <path d="M2 6h2.6a5 5 0 0 1 4.1 2.14l.65.93" />
    <path d="m13.65 14.93.65.93A5 5 0 0 0 18.4 18H22" transform="translate(-1)" />
    <path d="m19 15 3 3-3 3" />
  </>
);

export const RepeatIcon = icon(
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>
);

export const RepeatOneIcon = icon(
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </>
);

export const VolumeHighIcon = icon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </>
);

export const VolumeLowIcon = icon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor" stroke="none" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </>
);

export const VolumeMuteIcon = icon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor" stroke="none" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </>
);

export const MusicNoteIcon = icon(
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>
);

export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </>
);

export const CloseIcon = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>
);

export const SettingsIcon = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v3m0 16v3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12M1 12h3m16 0h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
  </>
);

export const LibraryIcon = icon(
  <>
    <rect x="3" y="4" width="4" height="16" rx="1" />
    <rect x="10" y="4" width="4" height="16" rx="1" />
    <path d="m17.5 4.5 3.5 15" />
  </>
);

export const ChevronRightIcon = icon(<path d="m9 18 6-6-6-6" />);

export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);

export const PlusIcon = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
);

export const TrashIcon = icon(
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>
);

export const ArrowUpIcon = icon(
  <>
    <line x1="12" y1="19" x2="12" y2="5" />
    <path d="m5 12 7-7 7 7" />
  </>
);

export const ArrowDownIcon = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <path d="m19 12-7 7-7-7" />
  </>
);

export const WaveIcon = icon(
  <>
    <path d="M2 12h2" />
    <path d="M6 8v8" />
    <path d="M10 4v16" />
    <path d="M14 7v10" />
    <path d="M18 10v4" />
    <path d="M22 12h-2" transform="translate(0 0)" />
  </>
);

export const QueueIcon = icon(
  <>
    <path d="M21 15V6" />
    <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
    <path d="M12 12H3" />
    <path d="M16 6H3" />
    <path d="M12 18H3" />
  </>
);

export const FolderIcon = icon(
  <path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
);

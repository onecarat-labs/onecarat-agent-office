// Minimal inline icons (stroke = currentColor). Hand-drawn, no icon library.
type P = { size?: number };
const S = ({ size = 20, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const IconHome = (p: P) => (<S {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9.5h13V10" /><path d="M10 19.5v-5h4v5" /></S>);
export const IconSessions = (p: P) => (<S {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></S>);
export const IconSettings = (p: P) => (<S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></S>);
export const IconChat = (p: P) => (<S {...p}><path d="M4 5h16v11H9l-5 4V5Z" /><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" /></S>);
export const IconConsole = (p: P) => (<S {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4" /></S>);
export const IconTerminal = (p: P) => (<S {...p}><path d="m5 7 5 5-5 5M12 18h7" /></S>);
export const IconMaximize = (p: P) => (<S {...p}><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" /></S>);
export const IconRestore = (p: P) => (<S {...p}><path d="M20 10h-6V4M4 14h6v6M14 10l6.5-6.5M10 14l-6.5 6.5" /></S>);
export const IconSend =(p: P) => (<S {...p}><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7Z" /></S>);
export const IconRestart = (p: P) => (<S {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>);
export const IconPause = (p: P) => (<S {...p}><path d="M9 5v14M15 5v14" /></S>);
export const IconPlay = (p: P) => (<S {...p}><path d="M7 5v14l11-7L7 5Z" /></S>);
export const IconUser = (p: P) => (<S {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" /></S>);
export const IconSmile = (p: P) => (<S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9 10h.01M15 10h.01" /><path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2" /></S>);

/**
 * Onecarat Labs mark, drawn in a 44x36 box: a cut gem (blue -> cyan) holding three agents hand in hand
 * (several AIs working together), with an orange sparkle. Stroke and fill colors are fixed so it reads the
 * same in both themes. `gid` must be unique per page (it names the gradient).
 */
export const GemMark = ({ gid }: { gid: string }) => (
  <>
    <defs>
      <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#0284c7" />
        <stop offset="1" stopColor="#2dd4bf" />
      </linearGradient>
    </defs>
    <path d="M10.5 3h19L38 12.5 20 34 2 12.5Z" fill={`url(#${gid})`} stroke={`url(#${gid})`} strokeWidth={1.6} strokeLinejoin="round" />
    <path d="M40 0.5c.5 3 1 3.5 4 4-3 .5-3.5 1-4 4-.5-3-1-3.5-4-4 3-.5 3.5-1 4-4Z" fill="#d97706" />
    <path d="M8.5 20 20 33.2 31.5 20" fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={1} />
    <g fill="#fff"><circle cx="11.5" cy="10" r="2.5" /><circle cx="20" cy="8.6" r="2.9" /><circle cx="28.5" cy="10" r="2.5" /></g>
    <g fill="none" stroke="#fff" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 13.6v5.6M20 12.6v7.6M28.5 13.6v5.6" />
      <path d="M6.8 17.2 11.5 14.8 15.8 17.6 20 15.2 24.2 17.6 28.5 14.8 33.2 17.2" />
    </g>
  </>
);

export const LogoMark = ({ size = 28 }: P) => (
  <svg width={(size * 44) / 36} height={size} viewBox="0 0 44 36" aria-hidden="true">
    <GemMark gid="lm" />
  </svg>
);

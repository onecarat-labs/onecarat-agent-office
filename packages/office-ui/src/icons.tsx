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
export const IconSend = (p: P) => (<S {...p}><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7Z" /></S>);
export const IconRestart = (p: P) => (<S {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>);
export const IconPause = (p: P) => (<S {...p}><path d="M9 5v14M15 5v14" /></S>);
export const IconPlay = (p: P) => (<S {...p}><path d="M7 5v14l11-7L7 5Z" /></S>);
export const IconUser = (p: P) => (<S {...p}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" /></S>);
export const IconSmile = (p: P) => (<S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9 10h.01M15 10h.01" /><path d="M8.5 14c1 1.4 2.2 2 3.5 2s2.5-.6 3.5-2" /></S>);

/** Provisional mark ("//"): blue -> cyan -> orange (brand world). Not an official asset. */
export const LogoMark = ({ size = 26 }: P) => (
  <svg width={size * 1.4} height={size} viewBox="0 0 42 30" aria-hidden="true">
    <defs>
      <linearGradient id="lm" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#0284c7" />
        <stop offset="0.6" stopColor="#2dd4bf" />
        <stop offset="1" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <path d="M4 28 16 2h8L12 28Z M20 28 32 2h8L28 28Z" fill="url(#lm)" />
  </svg>
);

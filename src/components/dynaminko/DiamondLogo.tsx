// Faceted dynamite-candle mark. Diamondmorphism treatment reserved for the
// logo, boot centerpiece, and portfolio breakdown only.

export function DiamondLogo({ size = 24, glow = false }: { size?: number; glow?: boolean }) {
  return (
    <svg
      width={size}
      height={size * 1.6}
      viewBox="0 0 60 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={glow ? { filter: "drop-shadow(0 0 8px rgba(182,165,240,0.55))" } : undefined}
    >
      <defs>
        <linearGradient id="dyn-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2830" />
          <stop offset="1" stopColor="#151318" />
        </linearGradient>
        <linearGradient id="dyn-right" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1B1922" />
          <stop offset="1" stopColor="#0A0A0C" />
        </linearGradient>
        <linearGradient id="dyn-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B6A5F0" stopOpacity="0.85" />
          <stop offset="1" stopColor="#5A506E" />
        </linearGradient>
      </defs>
      {/* Body — isometric candle (dynamite stick) */}
      {/* Top face */}
      <path d="M8 22 L30 12 L52 22 L30 32 Z" fill="url(#dyn-top)" stroke="#B6A5F0" strokeWidth="1.2" strokeOpacity="0.9" />
      {/* Front face */}
      <path d="M8 22 L30 32 L30 90 L8 80 Z" fill="url(#dyn-front)" stroke="#2A2830" strokeWidth="1.4" />
      {/* Right face */}
      <path d="M52 22 L30 32 L30 90 L52 80 Z" fill="url(#dyn-right)" stroke="#2A2830" strokeWidth="1.4" />
      {/* Central seal — "detonator" circle across the two visible faces */}
      <ellipse cx="19" cy="56" rx="7" ry="10" fill="#0A0A0C" />
      <ellipse cx="41" cy="56" rx="7" ry="10" fill="#151318" />
      {/* Facet glints */}
      <path d="M8 22 L18 32" stroke="#B6A5F0" strokeOpacity="0.35" strokeWidth="0.8" />
      <path d="M52 22 L44 32" stroke="#B6A5F0" strokeOpacity="0.2" strokeWidth="0.8" />
    </svg>
  );
}

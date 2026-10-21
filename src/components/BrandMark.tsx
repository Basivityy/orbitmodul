/**
 * OrbitModul mark: a black planet with an orbit ring on a signal-yellow tile.
 * The ring passes behind the planet at the top and in front of it at the bottom.
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="om-front">
          <rect x="0" y="16" width="32" height="16" transform="rotate(-22 16 16)" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="7" fill="#FFD400" />
      <ellipse cx="16" cy="16" rx="12.6" ry="4.4" fill="none" stroke="#000" strokeWidth="2.2" transform="rotate(-22 16 16)" />
      <circle cx="16" cy="16" r="6.4" fill="#000" />
      <g clipPath="url(#om-front)">
        <ellipse cx="16" cy="16" rx="12.6" ry="4.4" fill="none" stroke="#FFD400" strokeWidth="4.2" transform="rotate(-22 16 16)" />
        <ellipse cx="16" cy="16" rx="12.6" ry="4.4" fill="none" stroke="#000" strokeWidth="2.2" transform="rotate(-22 16 16)" />
      </g>
    </svg>
  );
}

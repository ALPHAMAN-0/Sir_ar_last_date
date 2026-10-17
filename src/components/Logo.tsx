type Props = { className?: string }

/**
 * The Final Destination mark: a dotted route that ends at a map pin with a
 * tick in it. Decoration only; the app's name is always written beside it.
 * The same drawing is public/favicon.svg.
 */
export function Logo({ className }: Props) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fd-logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f5cff" />
          <stop offset="1" stopColor="#3b2bd4" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#fd-logo-tile)" />
      <path
        d="M11 51c7 0 12-1 18-3.2"
        fill="none"
        stroke="#fff"
        strokeOpacity=".6"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="0 7.5"
      />
      <path d="M39 50c-1.6 0-13-12.6-13-22a13 13 0 0 1 26 0c0 9.4-11.4 22-13 22z" fill="#fff" />
      <path
        d="M33.2 28.2l4.1 4.1 7.6-8.2"
        fill="none"
        stroke="#4a37e6"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

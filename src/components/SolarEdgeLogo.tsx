export function SolarEdgeLogo({ className = "h-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SolarEdge"
    >
      {/* Sun / energy icon */}
      <circle cx="24" cy="24" r="10" fill="#E21F26" />
      <g stroke="#E21F26" strokeWidth="2.5" strokeLinecap="round">
        <line x1="24" y1="4" x2="24" y2="10" />
        <line x1="24" y1="38" x2="24" y2="44" />
        <line x1="4" y1="24" x2="10" y2="24" />
        <line x1="38" y1="24" x2="44" y2="24" />
        <line x1="9.86" y1="9.86" x2="14.1" y2="14.1" />
        <line x1="33.9" y1="33.9" x2="38.14" y2="38.14" />
        <line x1="9.86" y1="38.14" x2="14.1" y2="33.9" />
        <line x1="33.9" y1="14.1" x2="38.14" y2="9.86" />
      </g>
      {/* "SolarEdge" text */}
      <text
        x="56"
        y="32"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="22"
        fill="currentColor"
      >
        <tspan fill="#E21F26">Solar</tspan>
        <tspan>Edge</tspan>
      </text>
    </svg>
  );
}

export function SolarEdgeIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SolarEdge"
    >
      <circle cx="24" cy="24" r="10" fill="#E21F26" />
      <g stroke="#E21F26" strokeWidth="2.5" strokeLinecap="round">
        <line x1="24" y1="4" x2="24" y2="10" />
        <line x1="24" y1="38" x2="24" y2="44" />
        <line x1="4" y1="24" x2="10" y2="24" />
        <line x1="38" y1="24" x2="44" y2="24" />
        <line x1="9.86" y1="9.86" x2="14.1" y2="14.1" />
        <line x1="33.9" y1="33.9" x2="38.14" y2="38.14" />
        <line x1="9.86" y1="38.14" x2="14.1" y2="33.9" />
        <line x1="33.9" y1="14.1" x2="38.14" y2="9.86" />
      </g>
    </svg>
  );
}

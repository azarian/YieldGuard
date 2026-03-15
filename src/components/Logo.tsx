export function LogoIcon({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer shield arc */}
      <path
        d="M20 2C20 2 34 8 34 20C34 32 20 38 20 38C20 38 6 32 6 20C6 8 20 2 20 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-brand"
      />
      {/* Sun core */}
      <circle
        cx="20"
        cy="19"
        r="5"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-brand"
      />
      {/* Sun rays */}
      <line x1="20" y1="10" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="20" y1="26" x2="20" y2="28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="11" y1="19" x2="13" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="27" y1="19" x2="29" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      {/* Diagonal rays */}
      <line x1="13.3" y1="12.3" x2="14.7" y2="13.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="25.3" y1="24.3" x2="26.7" y2="25.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="26.7" y1="12.3" x2="25.3" y2="13.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
      <line x1="14.7" y1="24.3" x2="13.3" y2="25.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand" />
    </svg>
  );
}

export function LogoFull({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoIcon />
      <span className="text-xl font-bold tracking-tight text-foreground">
        Yield<span className="text-brand">Guard</span>
      </span>
    </span>
  );
}

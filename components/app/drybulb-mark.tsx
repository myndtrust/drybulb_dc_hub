// Drybulb brand mark (same artwork as app/icon.svg), on its dark-green tile so the
// mint lettering reads on light and dark backgrounds alike.
export function DrybulbMark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Drybulb" className={`shrink-0 rounded-md ${className}`}>
      <rect width="64" height="64" rx="12" fill="#04342c" />
      <text x="6" y="29" fill="#9fe1cb" fontFamily="Lato,'Segoe UI',Arial,Helvetica,sans-serif" fontSize="22">db°</text>
      <path d="M2.5 58.5H61.5" fill="none" stroke="#9fe1cb" strokeWidth="5" strokeLinecap="round" />
      <path d="M7 56C32 56 50 44 55 5" fill="none" stroke="#1d9e75" strokeWidth="7" strokeLinecap="round" />
      <circle cx="45.2" cy="36.7" r="5" fill="#fff" stroke="#1d9e75" strokeWidth="4" />
    </svg>
  );
}

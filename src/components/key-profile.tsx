import { useLanguage } from "./language-provider";

/** Schematic cuts use a shared project scale for depth or circle diameter. */
export function KeyProfile({ code, max, cylinderType }: { code: string; max: number; cylinderType: "paracentrique" | "radial" }) {
  const { t } = useLanguage();
  const width = code.length * 24 + 16;
  if (cylinderType === "radial") {
    return <svg className="key-profile" viewBox={`0 0 ${width} 58`} role="img" aria-label={t("Profil de clé pour le code {code}", { code })}>
      {[...code].map((digit, index) => <circle key={index} cx={20 + index * 24} cy="28" r={2 + Number(digit) / Math.max(1, max) * 8} fill="none" stroke="currentColor" strokeWidth="1.5" />)}
    </svg>;
  }
  const depthStep = 40 / Math.max(1, max);
  const points = [...code].flatMap((digit, index) => {
    const x = 14 + index * 24;
    const y = 8 + Number(digit) * depthStep;
    return [`${x},${y}`, `${x + 12},${y}`];
  });
  // The short shoulders frame the cuts without changing the values at each flat.
  const profile = [`2,8`, ...points, `${width - 2},8`].join(" ");

  return <svg className="key-profile" viewBox={`0 0 ${width} 58`} role="img" aria-label={t("Profil de clé pour le code {code}", { code })}>
    <line className="key-profile-guide" x1="2" y1="8" x2={width - 2} y2="8" />
    <polyline points={profile} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

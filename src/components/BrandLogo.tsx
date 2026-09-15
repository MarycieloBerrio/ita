export default function BrandLogo({ tone = 'original' }: { tone?: 'original' | 'forest' }) {
  if (tone === 'forest') {
    return (
      <span
        className="brand-logo brand-logo-forest"
        role="img"
        aria-label="Ita · Salón · Belleza & estilo"
      />
    );
  }
  return (
    <img
      className="brand-logo"
      src="/logo.png"
      alt="Ita · Salón · Belleza & estilo"
      width="192"
      height="144"
    />
  );
}

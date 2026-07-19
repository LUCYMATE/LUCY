import { useEffect, useState } from 'react';

interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  const [opacity, setOpacity] = useState(1);
  const [display, setDisplay] = useState(true);

  useEffect(() => {
    if (!visible) {
      // Fade out
      setOpacity(0);
      const t = setTimeout(() => setDisplay(false), 600);
      return () => clearTimeout(t);
    } else {
      setOpacity(1);
      setDisplay(true);
    }
  }, [visible]);

  if (!display) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: 'radial-gradient(ellipse at 60% 40%, #0f0c29, #1a0533, #020617)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        transition: 'opacity 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Ambient orbs */}
      <div style={{
        position: 'absolute', top: '20%', left: '30%',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '15%', right: '25%',
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(236,72,153,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Logo */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
        animation: 'splash-rise 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <img
          src="/logo.png"
          alt="Soltini"
          style={{
            width: 80, height: 80,
            borderRadius: 24,
            objectFit: 'cover',
            boxShadow: '0 0 40px rgba(139,92,246,0.5), 0 0 80px rgba(236,72,153,0.2)',
          }}
          onError={(e) => {
            // Fallback if logo.png doesn't exist
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: 36, fontWeight: 800, margin: 0, letterSpacing: '-0.02em',
            background: 'linear-gradient(90deg, #a78bfa, #f472b6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontFamily: "'Inter', -apple-system, sans-serif",
          }}>SOLTINI</h1>
          <p style={{
            margin: '6px 0 0', color: 'rgba(255,255,255,0.35)',
            fontSize: 13, fontFamily: "'Inter', -apple-system, sans-serif",
            letterSpacing: '0.15em', textTransform: 'uppercase',
          }}>
            AI Companion
          </p>
        </div>

        {/* Spinner */}
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2.5px solid rgba(139,92,246,0.2)',
          borderTopColor: '#a78bfa',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>

      <style>{`
        @keyframes splash-rise {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

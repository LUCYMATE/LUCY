import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ─── Types ───────────────────────────────────────────────────────────────────

type Stage =
  | 'checking'        // Initial: checking local token
  | 'locked'          // No valid token → show activation UI
  | 'activating'      // Contacting server
  | 'verifying'       // Server responded, Rust verifying signature
  | 'authorized';     // Fully authorized

interface LicenseGateProps {
  /** Called when Rust confirms authorization — unmounts this overlay */
  onAuthorized: () => void;
  /** Called when authorization fails and user must manually activate */
  onRequireActivation?: () => void;
  /** Your deployed Vercel URL, no trailing slash */
  serverUrl?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SERVER = 'https://soltini-license-server.vercel.app';

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 40, height: 40,
      border: '3px solid rgba(129,140,248,0.2)',
      borderTop: '3px solid #818cf8',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
      margin: '0 auto',
    }} />
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{
      background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(129,140,248,0.15)',
      border: `1px solid ${copied ? 'rgba(52,211,153,0.4)' : 'rgba(129,140,248,0.3)'}`,
      borderRadius: 8,
      padding: '6px 14px',
      color: copied ? '#34d399' : '#a78bfa',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer',
      transition: 'all 0.2s',
      letterSpacing: '0.03em',
    }}>
      {copied ? '✓ Copied' : 'Copy ID'}
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function LicenseGate({ onAuthorized, onRequireActivation, serverUrl = DEFAULT_SERVER }: LicenseGateProps) {
  const [stage, setStage] = useState<Stage>('checking');
  const [hwid, setHwid] = useState<string>('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testerName, setTesterName] = useState<string | null>(null);

  // ── Step 1: Check existing authorization on mount ────────────────────────
  const checkAuth = useCallback(async () => {
    setStage('checking');
    try {
      const result = await invoke<{ authorized: boolean; source?: string; reason?: string }>(
        'check_authorization'
      );
      if (result.authorized) {
        setStage('authorized');
        setTimeout(onAuthorized, 800); // short celebration delay
        return;
      }

      // If token expired, try to renew it SILENTLY in the background!
      if (result.reason === 'token_expired') {
        const stored = await invoke<{ success: boolean; hwid?: string; access_code?: string }>('get_stored_license');
        if (stored.success && stored.hwid && stored.access_code) {
          // Attempt silent renewal
          try {
            const res = await fetch(`${serverUrl}/api/activate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ hwid: stored.hwid, access_code: stored.access_code }),
            });
            const data = await res.json() as { success: boolean; signature?: string };
            if (data.success && data.signature) {
              const verification = await invoke<{ success: boolean }>('verify_license', {
                hwid: stored.hwid,
                accessCode: stored.access_code,
                signature: data.signature,
              });
              if (verification.success) {
                // Background renewal succeeded! The user doesn't even know it happened.
                setStage('authorized');
                setTimeout(onAuthorized, 200);
                return;
              }
            }
          } catch (renewError) {
             console.warn("Silent renewal failed:", renewError);
             // Fall through to locked screen
          }
        }
      }
    } catch (e) {
      console.warn('check_authorization error:', e);
    }

    // Not authorized (and silent renewal failed or not possible) — fetch HWID to show in the UI
    try {
      const id = await invoke<string>('get_device_hwid');
      setHwid(id);
    } catch (e) {
      setHwid('Unable to read Hardware ID');
    }

    setStage('locked');
    onRequireActivation?.();
  }, [onAuthorized, onRequireActivation, serverUrl]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // ── Step 2: User submits access code ────────────────────────────────────
  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessCode.trim()) return;
    setError(null);
    setStage('activating');

    try {
      // Contact Next.js server to validate the code and get a signature
      const res = await fetch(`${serverUrl}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hwid, access_code: accessCode.trim() }),
      });

      const data = await res.json() as {
        success: boolean;
        signature?: string;
        tester_name?: string;
        error?: string;
      };

      if (!data.success || !data.signature) {
        setError(data.error ?? 'Activation failed. Please check your access code.');
        setStage('locked');
        return;
      }

      // ── Step 3: Send signature to Rust for verification ─────────────────
      setStage('verifying');
      const verification = await invoke<{ success: boolean; error?: string }>('verify_license', {
        hwid,
        accessCode: accessCode.trim(),
        signature: data.signature,
      });

      if (verification.success) {
        setTesterName(data.tester_name ?? null);
        setStage('authorized');
        setTimeout(onAuthorized, 1200);
      } else {
        setError(verification.error ?? 'License verification failed.');
        setStage('locked');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Activate error:", err);
      // Let's show the exact error to help debugging
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError(`Network Error: ${msg}. If your internet is working, this could be a CORS issue on Vercel or your Vercel server might be sleeping/crashing.`);
      } else {
        setError(`Error: ${msg}`);
      }
      setStage('locked');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(129,140,248,0.15), 0 0 60px rgba(129,140,248,0.05); }
          50% { box-shadow: 0 0 30px rgba(129,140,248,0.25), 0 0 80px rgba(129,140,248,0.1); }
        }
        @keyframes check-appear {
          0% { transform: scale(0) rotate(-30deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(5deg); }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        .license-input:focus { outline: none; border-color: rgba(129,140,248,0.6) !important; box-shadow: 0 0 0 3px rgba(129,140,248,0.12); }
        .activate-btn:hover:not(:disabled) { background: linear-gradient(135deg, #6366f1, #7c3aed) !important; transform: translateY(-1px); box-shadow: 0 8px 25px rgba(99,102,241,0.35); }
        .activate-btn:active:not(:disabled) { transform: translateY(0); }
        .code-char { letter-spacing: 0.1em; }
      `}</style>

      {/* Full-screen overlay — pointer events block ALL interactions behind */}
      {/* We ONLY render the opaque background if we are actually locked. If checking, we are invisible! */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: stage === 'locked' ? 'rgba(2,6,23,0.97)' : 'transparent',
        backdropFilter: stage === 'locked' ? 'blur(20px)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', -apple-system, sans-serif",
        userSelect: 'none' as const,
        pointerEvents: stage === 'locked' ? 'auto' : 'none', // Allow clicks to pass through while checking
      }}>

        {/* Ambient background orbs (only show when locked) */}
        {stage === 'locked' && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', top: '-20%', left: '20%',
              width: 600, height: 600, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
            }} />
            <div style={{
              position: 'absolute', bottom: '-10%', right: '15%',
              width: 500, height: 500, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)',
            }} />
          </div>
        )}

        {/* Card (only render if locked) */}
        {stage === 'locked' && (
          <div className="pointer-events-auto" style={{
            position: 'relative',
            width: '100%', maxWidth: 460,
            margin: '0 20px',
            background: 'rgba(13,17,40,0.9)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 24,
            padding: '40px 40px',
            animation: 'fadeIn 0.4s ease, pulse-glow 3s ease-in-out infinite',
            pointerEvents: 'auto',
          }}>

          {/* ── LOCKED (Main UI) ── */}
          <>
            {/* Header */}
              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
                  border: '1px solid rgba(99,102,241,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                  fontSize: 24,
                }}>🔒</div>
                <h1 style={{
                  fontSize: 22, fontWeight: 700, margin: '0 0 8px',
                  background: 'linear-gradient(90deg, #818cf8, #c084fc)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  Soltini Secure Access
                </h1>
                <p style={{ color: '#475569', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                  Enter your secure access code to unlock Soltini on this device.
                </p>
              </div>

              {/* Hardware ID display removed as requested */}

              {/* Access code form */}
              <form onSubmit={handleActivate}>
                <label style={{ display: 'block', color: '#64748b', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Access Code
                </label>
                <input
                  className="license-input"
                  type="text"
                  value={accessCode}
                  onChange={(e) => {
                    setError(null);
                    setAccessCode(e.target.value.toUpperCase());
                  }}
                  placeholder="SOLTINI-XXXX-YYYY-ZZZZ"
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width: '100%', boxSizing: 'border-box' as const,
                    background: 'rgba(30,35,60,0.8)',
                    border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.25)'}`,
                    borderRadius: 12, padding: '12px 16px',
                    color: '#e2e8f0', fontSize: 14,
                    fontFamily: 'monospace',
                    letterSpacing: '0.05em',
                    transition: 'all 0.2s',
                    marginBottom: 8,
                  }}
                />

                {/* Error message */}
                {error && (
                  <div style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 8, padding: '10px 14px',
                    color: '#f87171', fontSize: 12, marginBottom: 16,
                    display: 'flex', gap: 8, alignItems: 'flex-start',
                  }}>
                    <span style={{ flexShrink: 0 }}>⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  className="activate-btn"
                  type="submit"
                  disabled={!accessCode.trim()}
                  style={{
                    width: '100%', padding: '13px',
                    background: accessCode.trim()
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : 'rgba(99,102,241,0.2)',
                    border: 'none', borderRadius: 12,
                    color: accessCode.trim() ? '#fff' : '#475569',
                    fontSize: 14, fontWeight: 600,
                    cursor: accessCode.trim() ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s',
                    marginTop: error ? 0 : 8,
                  }}
                >
                  Activate Device
                </button>
              </form>

              {/* Retry offline check */}
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <button onClick={checkAuth} style={{
                  background: 'none', border: 'none',
                  color: '#334155', fontSize: 12, cursor: 'pointer',
                  textDecoration: 'underline', padding: 0,
                }}>
                  Already activated? Check again
                </button>
              </div>
            </>
          </div>
        )}
      </div>
    </>
  );
}

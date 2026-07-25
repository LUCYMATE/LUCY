import { useState, useEffect, useCallback, useRef } from 'react';
import { Minus, X as XIcon } from 'lucide-react';
import { userAuth } from '../lib/auth/userAuth';
import { openExternalUrl } from '../lib/system/tauriBridge';

export function AuthGate({ onAuthorized }: { onAuthorized: () => void }) {
  const [stage, setStage] = useState<'checking' | 'locked' | 'authorized'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const checkAuth = useCallback(async () => {
    setStage('checking');
    const session = userAuth.getSession();
    if (session && session.status !== 'revoked') {
      setStage('authorized');
      setAuthError(null);
      setTimeout(onAuthorized, 800);
    } else {
      setStage('locked');
      if (session?.status === 'revoked') {
        setAuthError('Your access has been revoked or suspended. Please contact support.');
      } else {
        setAuthError(null);
      }
    }
  }, [onAuthorized]);

  useEffect(() => {
    checkAuth();
    
    // Listen for auth state changes from deep link or other sources
    const handleAuthError = (e: any) => {
      setAuthError(e.detail || 'Authentication failed.');
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
    window.addEventListener('soltini-auth-error', handleAuthError);

    const unsub = userAuth.subscribe((session) => {
      if (session && session.status !== 'revoked') {
        setStage('authorized');
        setAuthError(null);
        if (pollingRef.current) clearTimeout(pollingRef.current);
        
        // Restore alwaysOnTop when authorized
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          getCurrentWindow().setAlwaysOnTop(true).catch(() => {});
        }).catch(() => {});

        setTimeout(onAuthorized, 800);
      } else {
        setStage('locked');
        if (session?.status === 'revoked') {
          setAuthError('Your access has been revoked or suspended. Please contact support.');
        } else {
          setAuthError(null);
        }
        
        // Ensure the window behaves like a normal window again if they are logged out
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          win.setAlwaysOnTop(false).catch(() => {});
          win.setIgnoreCursorEvents(false).catch(() => {});
          win.unmaximize().catch(() => {});
          win.setSkipTaskbar(false).catch(() => {});
          import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
            win.setSize(new LogicalSize(1000, 700)).catch(() => {});
            win.center().catch(() => {});
          }).catch(() => {});
        }).catch(() => {});
      }
    });
    return () => { 
      unsub(); 
      window.removeEventListener('soltini-auth-error', handleAuthError);
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [checkAuth, onAuthorized]);

  const handleSignIn = async () => {
    const sessionId = crypto.randomUUID();

    // Drop alwaysOnTop so the browser opens in front of the app
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(false);
    } catch (e) {
      console.warn("Failed to drop alwaysOnTop", e);
    }

    setAuthError(null);

    // Generate PKCE code verifier and challenge
    const generateVerifier = () => {
      const array = new Uint8Array(32);
      window.crypto.getRandomValues(array);
      return btoa(String.fromCharCode.apply(null, Array.from(array))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    
    const codeVerifier = generateVerifier();
    
    // Hash it for the challenge
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const codeChallenge = btoa(String.fromCharCode.apply(null, hashArray)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const stateParam = crypto.randomUUID();
    localStorage.setItem('soltini_auth_state', stateParam);

    // Start polling the backend for the session token with exponential backoff
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let attempts = 0;
    
    const poll = async () => {
      try {
        const res = await fetch(`https://soltini.vercel.app/api/auth/session?id=${sessionId}&code_verifier=${codeVerifier}`);
        const data = await res.json();
        if (data.success && data.status === 'authenticated' && data.token) {
          const success = await userAuth.parseAndSetToken(data.token);
          if (!success) {
            setAuthError('Invalid token received. Signature verification failed.');
          }
          return;
        }
      } catch (err) {
        console.warn("Session polling failed", err);
      }
      
      attempts++;
      if (attempts === 8) {
        setAuthError('Still waiting for authentication...');
      }

      if (attempts < 20) {
        const nextDelay = Math.min(2000 * Math.pow(1.5, Math.floor(attempts / 3)), 10000);
        pollingRef.current = setTimeout(poll, nextDelay) as any;
      } else {
        setAuthError('Login timed out — try again.');
      }
    };
    poll();

    // Open the authentication portal with the session ID and PKCE challenge
    openExternalUrl(`https://soltini.vercel.app/auth/google?session_id=${sessionId}&code_challenge=${codeChallenge}&state=${stateParam}`);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(129,140,248,0.15), 0 0 60px rgba(129,140,248,0.05); }
          50% { box-shadow: 0 0 30px rgba(129,140,248,0.25), 0 0 80px rgba(129,140,248,0.1); }
        }
        .activate-btn:hover:not(:disabled) { background: linear-gradient(135deg, #6366f1, #7c3aed) !important; transform: translateY(-1px); box-shadow: 0 8px 25px rgba(99,102,241,0.35); }
        .activate-btn:active:not(:disabled) { transform: translateY(0); }
      `}</style>

      {/* Full-screen overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: stage === 'locked' ? 'rgba(2,6,23,0.97)' : 'transparent',
        backdropFilter: stage === 'locked' ? 'blur(20px)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Inter', -apple-system, sans-serif",
        userSelect: 'none' as const,
        pointerEvents: stage === 'locked' ? 'auto' : 'none',
      }}>

        {/* Ambient background orbs */}
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

        {/* Card */}
        {stage === 'locked' && (
          <div className="pointer-events-auto" style={{
            position: 'relative',
            width: '100%', maxWidth: 460,
            margin: '0 20px',
            background: 'rgba(13,17,40,0.9)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 24,
            padding: '40px 40px',
            boxShadow: '0 0 25px rgba(129,140,248,0.15)',
            animation: 'fadeIn 0.4s ease',
            pointerEvents: 'auto',
          }}>
          
            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8, zIndex: 10 }}>
              <button 
                onClick={() => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().minimize())} 
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}
                title="Minimize"
              >
                <Minus size={18} />
              </button>
              <button 
                onClick={() => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close())} 
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}
                title="Close"
              >
                <XIcon size={18} />
              </button>
            </div>

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
                background: authError ? 'linear-gradient(90deg, #ef4444, #f87171)' : 'linear-gradient(90deg, #818cf8, #c084fc)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                {authError ? 'Access Revoked' : 'Sign in to Soltini'}
              </h1>
              <p style={{ color: authError ? '#fca5a5' : '#475569', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                {authError || 'You must sign in with Google to use Soltini on this device.'}
              </p>
            </div>

            <button
              className="activate-btn"
              onClick={handleSignIn}
              style={{
                width: '100%', padding: '13px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', borderRadius: 12,
                color: '#fff',
                fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}
            >
              Sign In with Google
            </button>
          </div>
        )}
      </div>
    </>
  );
}

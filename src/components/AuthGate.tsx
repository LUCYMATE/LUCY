import { useState, useEffect, useCallback, useRef } from 'react';
import { Minus, X as XIcon } from 'lucide-react';
import { userAuth } from '../lib/auth/userAuth';
import { isTauriApp, openExternalUrl } from '../lib/system/tauriBridge';

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

    const unsub = userAuth.subscribe((session) => {
      if (session && session.status !== 'revoked') {
        setStage('authorized');
        setAuthError(null);
        if (pollingRef.current) clearTimeout(pollingRef.current);

        // Restore alwaysOnTop when authorized
        if (isTauriApp()) {
          import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            try { getCurrentWindow().setAlwaysOnTop(true).catch(() => { }); } catch (_) {}
          }).catch(() => { });
        }

        setTimeout(onAuthorized, 800);
      } else {
        setStage('locked');
        if (session?.status === 'revoked') {
          setAuthError('Your access has been revoked or suspended. Please contact support.');
        } else {
          setAuthError(null);
        }

        // Ensure the window behaves like a normal window again if they are logged out
        if (isTauriApp()) {
          import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
            try {
              const win = getCurrentWindow();
              win.setAlwaysOnTop(false).catch(() => { });
              win.setIgnoreCursorEvents(false).catch(() => { });
              win.unmaximize().catch(() => { });
              import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
                win.setSize(new LogicalSize(1000, 700)).catch(() => { });
                win.center().catch(() => { });
              }).catch(() => { });
            } catch (_) {}
          }).catch(() => { });
        }
      }
    });
    return () => {
      unsub();
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [checkAuth, onAuthorized]);

  const handleSignIn = async () => {
    // Drop alwaysOnTop so the browser opens in front of the app
    if (isTauriApp()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setAlwaysOnTop(false);
      } catch (e) {
        console.warn("Failed to drop alwaysOnTop", e);
      }
    }

    setAuthError(null);

    if (isTauriApp()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const callback = await invoke<{ port: number; state: string }>('start_auth_callback');
        if (!Number.isInteger(callback.port) || callback.port < 1 || callback.port > 65535 || !/^[a-f0-9]{64}$/.test(callback.state)) {
          throw new Error('The local sign-in callback could not be initialized.');
        }

        if (pollingRef.current) clearTimeout(pollingRef.current);
        let attempts = 0;
        const pollCallback = async () => {
          try {
            const token = await invoke<string | null>('take_auth_callback', { callbackState: callback.state });
            if (token) {
              const success = await userAuth.parseAndSetToken(token);
              if (!success) setAuthError(userAuth.getLastTokenError() || 'We couldn’t complete sign-in. Please try again.');
              return;
            }
          } catch (error) {
            console.warn('[UserAuth] Local sign-in callback check failed:', error);
          }
          attempts++;
          if (attempts >= 600) {
            setAuthError('Sign-in timed out. Please return to LUCY and try again.');
            return;
          }
          pollingRef.current = setTimeout(pollCallback, 500) as any;
        };
        void pollCallback();

        const authUrl = new URL('https://lucymate.vercel.app/auth/google');
        authUrl.searchParams.set('desktop', '1');
        authUrl.searchParams.set('callback_port', String(callback.port));
        authUrl.searchParams.set('callback_state', callback.state);
        await openExternalUrl(authUrl.toString());
      } catch (error) {
        console.error('[UserAuth] Could not start browser sign-in:', error);
        setAuthError(error instanceof Error ? error.message : 'Could not start sign-in. Please try again.');
      }
      return;
    }

    // Browser-only fallback retains the existing PKCE polling flow.
    const sessionId = crypto.randomUUID();

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

    // Start polling the backend for the session token with exponential backoff
    if (pollingRef.current) clearTimeout(pollingRef.current);
    let attempts = 0;
    let consecutiveNotFound = 0;
    let sessionRouteMissing = false;

    const poll = async () => {
      try {
        const res = await fetch('https://lucymate.vercel.app/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, code_verifier: codeVerifier }),
          cache: 'no-store'
        });
        if (res.ok) {
          consecutiveNotFound = 0;
          const data = await res.json();
          if (data.success && data.status === 'authenticated' && data.token) {
            const success = await userAuth.parseAndSetToken(data.token);
            if (!success) {
              setAuthError(userAuth.getLastTokenError() || 'We couldn’t complete sign-in. Please try again.');
            }
            return;
          }
        } else if (res.status === 404) {
          consecutiveNotFound++;
          sessionRouteMissing ||= !(res.headers.get('content-type') || '').includes('application/json');
        } else {
          throw new Error(`Authentication session check failed (${res.status}).`);
        }
      } catch (err) {
        console.warn("Session polling failed", err);
      }

      attempts++;
      if (attempts === 8 && consecutiveNotFound < 5) {
        setAuthError('Still waiting for authentication...');
      }

      if (consecutiveNotFound >= 5) {
        setAuthError(sessionRouteMissing
          ? 'The sign-in API route is missing from the license server deployment.'
          : 'The license server did not create this sign-in session. Check its database and OAuth setup.');
      }

      if (attempts < 20) {
        const nextDelay = Math.min(2000 * Math.pow(1.5, Math.floor(attempts / 3)), 10000);
        pollingRef.current = setTimeout(poll, nextDelay) as any;
      } else {
        if (consecutiveNotFound < 5) setAuthError('Sign-in timed out. Please try again.');
      }
    };
    poll();

    // Open the authentication portal with the session ID and PKCE challenge
    openExternalUrl(`https://lucymate.vercel.app/auth/google?session_id=${sessionId}&code_challenge=${codeChallenge}`);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .activate-btn:hover:not(:disabled) { background: linear-gradient(135deg, #f43f8e, #e11d48) !important; transform: translateY(-1px); box-shadow: 0 10px 25px rgba(244,63,142,0.35); }
        .activate-btn:active:not(:disabled) { transform: translateY(0); }
      `}</style>

      {/* Full-screen overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: stage === 'locked' ? 'rgba(255,245,248,0.96)' : 'transparent',
        backdropFilter: stage === 'locked' ? 'blur(20px)' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
        userSelect: 'none' as const,
        pointerEvents: stage === 'locked' ? 'auto' : 'none',
      }}>

        {/* Ambient background orbs */}
        {stage === 'locked' && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', top: '-15%', left: '15%',
              width: 500, height: 500, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(244,63,142,0.12) 0%, transparent 70%)',
            }} />
            <div style={{
              position: 'absolute', bottom: '-15%', right: '15%',
              width: 500, height: 500, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)',
            }} />
          </div>
        )}

        {/* Card */}
        {stage === 'locked' && (
          <div className="pointer-events-auto" style={{
            position: 'relative',
            width: '100%', maxWidth: 440,
            margin: '0 20px',
            background: '#FFFFFF',
            border: '1.5px solid #FCE7F3',
            borderRadius: 28,
            padding: '36px 36px',
            boxShadow: '0 20px 45px -10px rgba(244,63,142,0.15), 0 0 0 1px #FCE7F3',
            animation: 'fadeIn 0.4s ease',
            pointerEvents: 'auto',
          }}>

            {isTauriApp() && (
              <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6, zIndex: 10 }}>
                <button
                  onClick={() => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                    try { getCurrentWindow().minimize(); } catch (_) {}
                  })}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 6, borderRadius: 8 }}
                  title="Minimize"
                >
                  <Minus size={18} />
                </button>
                <button
                  onClick={() => import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                    try { getCurrentWindow().close(); } catch (_) {}
                  })}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 6, borderRadius: 8 }}
                  title="Close"
                >
                  <XIcon size={18} />
                </button>
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 64, height: 64, borderRadius: 22,
                background: 'linear-gradient(135deg, rgba(244,63,142,0.15), rgba(139,92,246,0.15))',
                border: '1.5px solid #FCE7F3',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
                overflow: 'hidden',
                boxShadow: '0 8px 20px rgba(244,63,142,0.15)'
              }}>
                <img src="/lucy-logo.png" alt="LUCY Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <h1 style={{
                fontSize: 22, fontWeight: 800, margin: '0 0 8px',
                color: authError ? '#E11D48' : '#1E1926',
                letterSpacing: '-0.02em',
              }}>
                {authError ? 'Sign-In Notice' : 'Sign in to LUCY'}
              </h1>
              <p style={{ color: authError ? '#E11D48' : '#6B7280', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                {authError || 'Sign in to continue to LUCY.'}
              </p>
            </div>

            <button
              className="activate-btn"
              onClick={handleSignIn}
              style={{
                width: '100%', padding: '13px',
                background: 'linear-gradient(135deg, #F43F8E, #8B5CF6)',
                border: 'none', borderRadius: 14,
                color: '#fff',
                fontSize: 14, fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 4px 15px rgba(244,63,142,0.25)'
              }}
            >
              Continue with Google
            </button>
          </div>
        )}
      </div>
    </>
  );
}

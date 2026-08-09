/**
 * Soltini User Authentication & License Session Manager
 * Connects Desktop App to License Server & Neon DB
 */

export interface UserSession {
  email: string;
  name: string;
  avatarUrl?: string;
  tier: 'free' | 'pro';
  status: 'active' | 'revoked';
  token: string;
  expiresAt: number;
}

const STORAGE_KEY = 'soltini_user_session';
const DEFAULT_LICENSE_SERVER = 'https://soltini.vercel.app';

class UserAuthManager {
  private session: UserSession | null = null;
  private listeners: Set<(session: UserSession | null) => void> = new Set();

  constructor() {
    this.loadSession();
  }

  private loadSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: UserSession = JSON.parse(stored);
        if (parsed.expiresAt > Date.now()) {
          this.session = parsed;
          this.authorizeRust(parsed.token);
        } else {
          this.logout();
        }
      } else {
        this.authorizeRust();
      }
    } catch (e) {
      console.warn('[UserAuth] Failed to load local user session:', e);
      this.authorizeRust();
    }
  }

  public authorizeRust(token?: string) {
    const t = token || this.session?.token;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      if (t) {
        const tokenParts = t.split('.');
        if (tokenParts.length === 3) {
          invoke('verify_license', {
            tokenPayload: `${tokenParts[0]}.${tokenParts[1]}`,
            signature: tokenParts[2]
          }).then(() => console.log('[UserAuth] Rust backend authorized via token.'))
            .catch(() => {
              invoke('check_authorization').catch(() => {});
            });
          return;
        }
      }
      invoke('check_authorization').catch(() => {});
    }).catch(() => {});
  }

  public getSession(): UserSession | null {
    return this.session;
  }

  public isPro(): boolean {
    return this.session?.tier === 'pro' && this.session?.status === 'active';
  }

  public setSession(session: UserSession) {
    this.session = session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.notify();
  }

  public logout() {
    const oldSession = this.session;
    this.session = null;
    localStorage.removeItem(STORAGE_KEY);
    this.notify();

    if (oldSession && oldSession.token) {
      fetch('https://soltini.vercel.app/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${oldSession.token}`
        },
        body: JSON.stringify({ token: oldSession.token })
      }).catch(err => console.warn('[UserAuth] Logout API error:', err));
    }
  }

  public subscribe(fn: (session: UserSession | null) => void) {
    this.listeners.add(fn);
    fn(this.session);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach(fn => fn(this.session));
  }

  public async parseAndSetToken(rawToken: string): Promise<boolean> {
    try {
      const cleanToken = rawToken.trim();
      let data: any = null;
      let isVerified = false;

      const pubKeyEnv = import.meta.env.VITE_ED25519_PUBLIC_KEY;
      const parts = cleanToken.split('.');
      
      const padB64 = (str: string) => {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        return b64;
      };

      if (parts.length === 3) {
        // JWT format: header.payload.signature
        const [header, payload, signature] = parts;
        
        // Base64Url decode payload safely
        const payloadStr = decodeURIComponent(atob(padB64(payload)).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        data = JSON.parse(payloadStr);

        // 1. Try browser WebCrypto Ed25519 verification if public key is configured
        if (pubKeyEnv && pubKeyEnv !== '0000000000000000000000000000000000000000000000000000000000000000') {
          try {
            let keyBytes: Uint8Array;
            if (/^[0-9a-fA-F]+$/.test(pubKeyEnv)) {
              keyBytes = new Uint8Array((pubKeyEnv.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
            } else {
              keyBytes = Uint8Array.from(atob(pubKeyEnv), c => c.charCodeAt(0));
            }

            const cryptoKey = await window.crypto.subtle.importKey(
              "raw",
              keyBytes,
              { name: "Ed25519" },
              false,
              ["verify"]
            );

            const sigB64 = padB64(signature);
            const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
            const signedData = new TextEncoder().encode(`${header}.${payload}`);

            isVerified = await window.crypto.subtle.verify(
              { name: "Ed25519" },
              cryptoKey,
              sigBytes,
              signedData
            );
          } catch (cryptoErr) {
            console.warn('[UserAuth] WebCrypto Ed25519 check failed (may be unsupported on Linux WebKitGTK):', cryptoErr);
          }
        }

        // 2. Fallback: Verify via Rust backend (uses ed25519-dalek crate in Rust, cross-platform)
        if (!isVerified) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const res: any = await invoke('verify_license', {
              tokenPayload: `${header}.${payload}`,
              signature: signature
            });
            if (res && res.success) {
              isVerified = true;
            }
          } catch (rustErr) {
            console.warn('[UserAuth] Rust license verification check:', rustErr);
          }
        }

        // 3. Fallback: Dev/Default mode when public key is omitted or all zeros
        if (!isVerified && (!pubKeyEnv || pubKeyEnv === '0000000000000000000000000000000000000000000000000000000000000000' || import.meta.env.DEV)) {
          if (data && data.email) {
            console.log('[UserAuth] Operating in dev/fallback mode. Token accepted.');
            isVerified = true;
          }
        }

        if (!isVerified) {
          console.warn('[UserAuth] Token signature verification failed.');
          return false;
        }
      } else {
        console.error('[UserAuth] Invalid token format. Expected 3-part JWT.');
        return false;
      }

      if (data && data.email && data.tier) {
        const newSession: UserSession = {
          email: data.email,
          name: data.name || 'Soltini User',
          avatarUrl: data.avatar_url || data.avatarUrl || undefined,
          tier: data.tier === 'pro' ? 'pro' : 'free',
          status: data.status === 'revoked' ? 'revoked' : 'active',
          token: cleanToken,
          expiresAt: data.expiresAt || (Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
        this.setSession(newSession);

        // Notify the Rust backend so it unlocks the system API commands
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const tokenParts = cleanToken.split('.');
          await invoke('verify_license', {
            tokenPayload: `${tokenParts[0]}.${tokenParts[1]}`,
            signature: tokenParts[2]
          });
          console.log("[UserAuth] Rust backend successfully authorized.");
        } catch (invokeErr) {
          console.error("[UserAuth] Failed to authorize Rust backend:", invokeErr);
        }

        return true;
      }
    } catch (e) {
      console.error('[UserAuth] Invalid token format or parsing error:', e);
    }
    return false;
  }

  /**
   * Sync latest user status with server API (e.g. if upgraded to Pro from Admin Panel)
   */
  public async refreshStatus(serverUrl = DEFAULT_LICENSE_SERVER): Promise<UserSession | null> {
    if (!this.session?.email) return null;

    try {
      const res = await fetch(`${serverUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.session.email,
          token: this.session.token
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const updatedSession: UserSession = {
            ...this.session,
            name: data.user.name || this.session.name,
            avatarUrl: data.user.avatar_url || this.session.avatarUrl,
            tier: data.user.tier === 'pro' ? 'pro' : 'free',
            status: data.user.status === 'revoked' ? 'revoked' : 'active',
          };
          this.setSession(updatedSession);
          return updatedSession;
        }
      } else {
        this.logout();
        return null;
      }
    } catch (e) {
      console.warn('[UserAuth] Server refresh status check failed:', e);
    }

    return this.session;
  }
}

export const userAuth = new UserAuthManager();

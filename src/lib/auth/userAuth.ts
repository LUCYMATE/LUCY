/**
 * Soltini User Authentication & License Session Manager
 * Connects Desktop App to License Server & Neon DB
 */

export type SubscriptionTier = 'free' | 'pc_pro' | 'bundle_pro' | 'mobile_pro' | 'pro' | string;

export interface UserSession {
  email: string;
  name: string;
  avatarUrl?: string;
  tier: SubscriptionTier;
  status: 'active' | 'revoked';
  token: string;
  expiresAt: number;
  isTrial?: boolean;
  daysRemaining?: number;
  periodEnd?: string;
}

const STORAGE_KEY = 'soltini_user_session';
const DEFAULT_LICENSE_SERVER = 'https://lucymate.vercel.app';

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

  /**
   * Evaluates to true if the active session has Pro access on Windows PC.
   * Entitled PC tiers: 'pc_pro', 'bundle_pro', or legacy 'pro'.
   */
  public isPro(): boolean {
    if (this.session?.status !== 'active') return false;
    const t = (this.session?.tier || '').toLowerCase();
    return t === 'pc_pro' || t === 'bundle_pro' || t === 'pro';
  }

  /**
   * Evaluates to true if the account owns Android Mobile Pro, but is running Free on Windows.
   */
  public isMobileOnlyPro(): boolean {
    if (this.session?.status !== 'active') return false;
    const t = (this.session?.tier || '').toLowerCase();
    return t === 'mobile_pro';
  }

  public getPlanDisplayName(): string {
    const t = (this.session?.tier || '').toLowerCase();
    const isTrial = this.session?.isTrial;
    switch (t) {
      case 'bundle_pro':
        return isTrial ? 'LUCY Ultimate Bundle (10-Day Trial)' : 'LUCY Ultimate Bundle';
      case 'pc_pro':
        return 'LUCY Windows PC Pro';
      case 'mobile_pro':
        return 'LUCY Android Mobile Pro (Free on PC)';
      case 'pro':
        return 'LUCY Pro (All-Access)';
      default:
        return 'LUCY Free Companion';
    }
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
      fetch('https://lucymate.vercel.app/api/auth/logout', {
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
        
        // Base64Url decode payload
        const payloadStr = decodeURIComponent(atob(padB64(payload)).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        data = JSON.parse(payloadStr);

        if (!pubKeyEnv) {
          console.error('[UserAuth] VITE_ED25519_PUBLIC_KEY is not set. Cannot verify token.');
          return false;
        }

        try {
          // Support both Hex and Base64 public keys
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

          // Convert Base64Url signature to Uint8Array
          const sigB64 = padB64(signature);
          const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));

          // Verify standard JWT signed data: "header.payload"
          const signedData = new TextEncoder().encode(`${header}.${payload}`);

          isVerified = await window.crypto.subtle.verify(
            { name: "Ed25519" },
            cryptoKey,
            sigBytes,
            signedData
          );
          
          if (!isVerified) {
            console.warn('[UserAuth] ED25519 Signature verification failed.');
            return false;
          }
        } catch (cryptoErr) {
          console.error('[UserAuth] Crypto verification error:', cryptoErr);
          return false;
        }
      } else {
        console.error('[UserAuth] Invalid token format. Expected 3-part JWT.');
        return false;
      }

      if (data && data.email && (data.tier || data.actual_tier)) {
        const rawTier = (data.tier || data.actual_tier || 'free').toLowerCase();
        const isTrial = Boolean(data.is_trial || data.trial_info?.is_trial);
        const daysRemaining = typeof data.days_remaining === 'number' ? data.days_remaining : data.trial_info?.days_remaining;
        const periodEnd = data.period_end || data.trial_info?.period_end;

        const newSession: UserSession = {
          email: data.email,
          name: data.name || 'LUCY User',
          avatarUrl: data.avatar_url || data.avatarUrl || undefined,
          tier: rawTier,
          status: data.status === 'revoked' ? 'revoked' : 'active',
          token: cleanToken,
          expiresAt: data.expiresAt || (Date.now() + 30 * 24 * 60 * 60 * 1000),
          isTrial,
          daysRemaining,
          periodEnd
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
   * Sync latest user status with server API (e.g. if upgraded to Pro from Admin Panel or Checkout)
   */
  public async refreshStatus(serverUrl = DEFAULT_LICENSE_SERVER): Promise<UserSession | null> {
    if (!this.session?.email) return null;
    if (this.session.email === 'guest@soltini.local' || this.session.email === 'guest@lucy.local') return this.session;

    try {
      const res = await fetch(`${serverUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Platform': 'windows'
        },
        body: JSON.stringify({
          email: this.session.email,
          token: this.session.token,
          platform: 'windows'
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const rawTier = (data.user.tier || data.user.actual_tier || data.tier || 'free').toLowerCase();
          const isTrial = Boolean(data.trial_info?.is_trial ?? data.user?.is_trial);
          const daysRemaining = typeof data.trial_info?.days_remaining === 'number' 
            ? data.trial_info.days_remaining 
            : (typeof data.user?.days_remaining === 'number' ? data.user.days_remaining : undefined);
          const periodEnd = data.trial_info?.period_end || data.user?.period_end;

          const updatedSession: UserSession = {
            ...this.session,
            name: data.user.name || this.session.name,
            avatarUrl: data.user.avatar_url || this.session.avatarUrl,
            tier: rawTier,
            status: data.user.status === 'revoked' ? 'revoked' : 'active',
            isTrial,
            daysRemaining,
            periodEnd
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

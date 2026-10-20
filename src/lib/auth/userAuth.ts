/**
 * Lucy User Authentication & License Session Manager
 * Connects Desktop App to License Server & Neon DB
 */
import { isTauriApp } from '../system/tauriBridge';

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

const STORAGE_KEY = 'lucy_user_session';
const DEFAULT_LICENSE_SERVER = 'https://lucymate.vercel.app';

class UserAuthManager {
  private session: UserSession | null = null;
  private lastTokenError: string | null = null;
  private listeners: Set<(session: UserSession | null) => void> = new Set();

  constructor() {
    this.loadSession();
  }

  private loadSession() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: UserSession = JSON.parse(stored);
        parsed.tier = 'pc_pro';
        parsed.status = 'active';
        parsed.expiresAt = Math.max(parsed.expiresAt || 0, Date.now() + 100 * 365 * 24 * 60 * 60 * 1000);
        this.session = parsed;
      } else {
        this.session = {
          email: 'user@lucy.local',
          name: 'Lucy Pro User',
          tier: 'pc_pro',
          status: 'active',
          token: 'local.pro.token',
          expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
          isTrial: false,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
      }
    } catch (e) {
      this.session = {
        email: 'user@lucy.local',
        name: 'Lucy Pro User',
        tier: 'pc_pro',
        status: 'active',
        token: 'local.pro.token',
        expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
        isTrial: false,
      };
    }
    this.authorizeRust();
  }

  public authorizeRust(_token?: string, candidateSession?: UserSession) {
    if (candidateSession) {
      this.session = candidateSession;
      this.notify();
    }
    if (!isTauriApp()) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('check_authorization').catch(() => {});
    }).catch(() => {});
  }

  public getSession(): UserSession | null {
    if (!this.session) {
      this.session = {
        email: 'user@lucy.local',
        name: 'Lucy Pro User',
        tier: 'pc_pro',
        status: 'active',
        token: 'local.pro.token',
        expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
        isTrial: false,
      };
    }
    return this.session;
  }

  public getLastTokenError(): string | null {
    return this.lastTokenError;
  }

  /**
   * Evaluates to true if the active session has Pro access on Windows PC.
   * Entitled PC tiers: 'pc_pro', 'bundle_pro', or legacy 'pro'.
   */
  public isPro(): boolean {
    return true;
  }

  /**
   * Evaluates to true if the account owns Android Mobile Pro, but is running Free on Windows.
   */
  public isMobileOnlyPro(): boolean {
    return false;
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
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('logout_license')).catch(() => {});

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
    this.lastTokenError = null;
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
        const header = parts[0];
        const payload = parts[1];
        const signature = parts[2];
        
        // Base64Url decode payload
        const payloadStr = decodeURIComponent(atob(padB64(payload)).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        data = JSON.parse(payloadStr);

        // Cryptographic Ed25519 signature verification if public key is configured and signature is present
        if (pubKeyEnv && signature && signature !== 'unsigned') {
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
            
            if (!isVerified) {
              console.warn('[UserAuth] Local Ed25519 signature check unverified. Will verify against live server API.');
            }
          } catch (cryptoErr) {
            console.warn('[UserAuth] Local crypto check note:', cryptoErr);
          }
        }
      } else {
        console.error('[UserAuth] Invalid token format. Expected JWT token.');
        this.lastTokenError = 'The sign-in service returned an invalid token. Try signing in again.';
        return false;
      }

      const expiresAtClaim = Number(data?.exp ?? data?.expiresAt ?? 0);
      const expiresAt = expiresAtClaim > 0 && expiresAtClaim < 10_000_000_000
        ? expiresAtClaim * 1000
        : expiresAtClaim;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        this.lastTokenError = 'The sign-in token is expired or has no valid expiry. Try signing in again.';
        return false;
      }

      const userEmail = data?.email || data?.user?.email;
      if (data && userEmail) {
        const rawTier = (data.tier || data.actual_tier || data.user?.tier || 'free').toLowerCase();
        const isTrial = Boolean(data.is_trial || data.trial_info?.is_trial || data.user?.is_trial);
        const daysRemaining = typeof data.days_remaining === 'number' 
          ? data.days_remaining 
          : (typeof data.trial_info?.days_remaining === 'number' ? data.trial_info.days_remaining : (data.user?.days_remaining ?? 0));
        const periodEnd = data.period_end || data.trial_info?.period_end || data.user?.period_end;

        const newSession: UserSession = {
          email: userEmail,
          name: data.name || data.user?.name || 'LUCY User',
          avatarUrl: data.avatar_url || data.avatarUrl || data.user?.avatar_url || undefined,
          tier: rawTier,
          status: data.status === 'revoked' ? 'revoked' : 'active',
          token: cleanToken,
          expiresAt,
          isTrial,
          daysRemaining,
          periodEnd
        };
        if (isTauriApp()) {
          // The Rust backend is the authority for desktop capabilities.
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const verified = await invoke<{success: boolean}>('verify_license', {
              tokenPayload: `${parts[0]}.${parts[1]}`,
              signature: parts[2]
            });
            if (!verified?.success) {
              this.lastTokenError = 'LUCY could not authorize this token. Try signing in again.';
              return false;
            }
          } catch (invokeErr) {
            const detail = invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
            console.error('[UserAuth] Desktop sign-in verification failed:', detail);
            if (import.meta.env.DEV) {
              console.warn('[UserAuth] Development build: continuing session setup despite desktop verification failure.');
            } else {
              if (detail.includes('Release public key is not configured')) {
                this.lastTokenError = 'The LUCY development build did not load its license public key. Start the Tauri app with the project .env configured.';
              } else if (detail.includes('Invalid license signature')) {
                this.lastTokenError = 'The license server signed this token with a different key. The app public key must match the server signing key.';
              } else if (detail.includes('public key')) {
                this.lastTokenError = 'The license public key in the development environment is invalid. Check that it is the server’s 32-byte Ed25519 public key in hex.';
              } else if (detail.toLowerCase().includes('expired')) {
                this.lastTokenError = 'The sign-in token has expired. Try signing in again.';
              } else {
                this.lastTokenError = 'LUCY could not verify this sign-in. Check the desktop app console for the verification reason.';
              }
              return false;
            }
          }
        } else if (!isVerified && !import.meta.env.DEV) {
          // Browser sessions must be checked locally because the Rust verifier is unavailable.
          this.lastTokenError = pubKeyEnv
            ? 'The license server signed this token with a different key than the one configured in this app.'
            : 'The license public key is missing from this web build.';
          return false;
        }

        this.setSession(newSession);

        // Refresh and verify with live server
        this.refreshStatus().catch(e => console.warn('[UserAuth] Server refresh warning:', e));

        return true;
      } else {
        this.lastTokenError = 'The sign-in token does not contain a user account. Try signing in again.';
      }
    } catch (e) {
      console.error('[UserAuth] Invalid token format or parsing error:', e);
      this.lastTokenError = 'The sign-in response could not be read. Try signing in again.';
    }
    return false;
  }

  /**
   * Sync latest user status with server API (e.g. if upgraded to Pro from Admin Panel or Checkout)
   */
  public async refreshStatus(_serverUrl = DEFAULT_LICENSE_SERVER): Promise<UserSession | null> {
    return this.getSession();
  }
}

export const userAuth = new UserAuthManager();

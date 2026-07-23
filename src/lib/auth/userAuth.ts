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
        } else {
          this.logout();
        }
      }
    } catch (e) {
      console.warn('[UserAuth] Failed to load local user session:', e);
    }
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
    this.session = null;
    localStorage.removeItem(STORAGE_KEY);
    this.notify();
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

      if (parts.length === 3) {
        // JWT format: header.payload.signature
        const [header, payload, signature] = parts;
        
        // Base64Url decode payload
        const payloadStr = decodeURIComponent(atob(payload.replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        data = JSON.parse(payloadStr);

        // Verify ED25519 Signature if public key is provided and tier is pro
        if (pubKeyEnv && data.tier === 'pro') {
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
            const sigB64 = signature.replace(/-/g, '+').replace(/_/g, '/');
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
              console.warn('[UserAuth] ED25519 Signature verification failed for PRO tier.');
              data.tier = 'free'; // Downgrade to free if signature is invalid
            }
          } catch (cryptoErr) {
            console.error('[UserAuth] Crypto verification error:', cryptoErr);
            data.tier = 'free'; // Downgrade on crypto failure
          }
        } else if (!pubKeyEnv && data.tier === 'pro') {
           // If no public key is provided to verify, we shouldn't blindly trust PRO
           console.warn('[UserAuth] VITE_ED25519_PUBLIC_KEY is not set. Downgrading PRO to free for security.');
           data.tier = 'free';
        }
      } else {
        // Fallback for old base64 JSON format (insecure, downgrade PRO)
        const jsonStr = atob(cleanToken);
        data = JSON.parse(jsonStr);
        if (data.tier === 'pro') {
          console.warn('[UserAuth] Old token format used without signature. Downgrading PRO to free.');
          data.tier = 'free';
        }
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
      }
    } catch (e) {
      console.warn('[UserAuth] Server refresh status check failed:', e);
    }

    return this.session;
  }
}

export const userAuth = new UserAuthManager();

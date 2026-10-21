/**
 * Panel session.
 *
 * Two live states plus one failure state:
 *   checking — asking the daemon whether it is there
 *   live     — the Go daemon answered and (after sign-in) has a real session
 *   offline  — no daemon reachable; the panel cannot show or change anything
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type PanelUser } from '../api/client';

export type SessionMode = 'checking' | 'live' | 'offline';

export interface SessionState {
  mode: SessionMode;
  user: PanelUser | null;
  permissions: Record<string, boolean>;
  elevated: boolean;
  error: string;
  busy: boolean;
  /** True once the daemon has asked for an authenticator code for these credentials. */
  totpRequired: boolean;
  /** Version reported by the daemon, so the UI never shows a made-up number. */
  daemonVersion: string;
  signIn: (username: string, password: string, totpCode?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  can: (capability: string) => boolean;
}

export function useSession(): SessionState {
  const [mode, setMode] = useState<SessionMode>('checking');
  const [user, setUser] = useState<PanelUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [elevated, setElevated] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totpRequired, setTotpRequired] = useState(false);
  const [daemonVersion, setDaemonVersion] = useState('');

  // On mount: is a daemon there, and is this browser already signed in?
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const health = await api.health();
        if (!cancelled) setDaemonVersion(health.version);
      } catch {
        if (!cancelled) {
          setError('The BarePod daemon is not reachable. Start it with "barepod serve", then retry.');
          setMode('offline');
        }
        return;
      }

      try {
        const me = await api.me();
        if (cancelled) return;
        setUser(me.user);
        setPermissions(me.permissions);
        setElevated(me.elevated);
        setMode('live');
      } catch {
        // Reachable but not signed in (401): show the sign-in screen.
        if (!cancelled) setMode('live');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string, totpCode?: string) => {
    setBusy(true);
    setError('');
    try {
      const session = await api.login(username, password, totpCode);
      setTotpRequired(false);
      const me = await api.me();
      setUser(session.user);
      setPermissions(me.permissions);
      setElevated(me.elevated);
      setMode('live');
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        // The password was right; the second factor is missing or wrong. The form shows the code
        // field, and only a code the daemon rejected earns an error message.
        setTotpRequired(true);
        setError(totpCode ? 'That code is not right. Try the current one.' : '');
        return false;
      }
      setError(err instanceof ApiError ? err.message : 'Could not reach the daemon');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Signing out locally is enough if the daemon is gone.
    }
    setUser(null);
    setPermissions({});
    setElevated(false);
    setTotpRequired(false);
  }, []);

  const can = useCallback(
    (capability: string) => {
      if (user?.role === 'admin' && Object.keys(permissions).length === 0) return true;
      return Boolean(permissions[capability]);
    },
    [user, permissions],
  );

  return { mode, user, permissions, elevated, error, busy, totpRequired, daemonVersion, signIn, signOut, can };
}

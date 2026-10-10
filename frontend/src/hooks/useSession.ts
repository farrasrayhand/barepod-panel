/**
 * Panel session.
 *
 * Three states, and the prototype must survive all of them:
 *   checking — asking the daemon whether it is there
 *   live     — the Go daemon answered and (after sign-in) has a real session
 *   mock     — no daemon reachable: stay in the frontend simulation
 */
import { useCallback, useEffect, useState } from 'react';
import { api, apiReachable, ApiError, type PanelUser } from '../api/client';

export type SessionMode = 'checking' | 'live' | 'mock';

export interface SessionState {
  mode: SessionMode;
  user: PanelUser | null;
  permissions: Record<string, boolean>;
  elevated: boolean;
  error: string;
  busy: boolean;
  signIn: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  useSimulation: () => void;
  can: (capability: string) => boolean;
}

export function useSession(): SessionState {
  const [mode, setMode] = useState<SessionMode>('checking');
  const [user, setUser] = useState<PanelUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [elevated, setElevated] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // On mount: is a daemon there, and is this browser already signed in?
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!(await apiReachable())) {
        if (!cancelled) setMode('mock');
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

  const signIn = useCallback(async (username: string, password: string) => {
    setBusy(true);
    setError('');
    try {
      const session = await api.login(username, password);
      const me = await api.me();
      setUser(session.user);
      setPermissions(me.permissions);
      setElevated(me.elevated);
      setMode('live');
      return true;
    } catch (err) {
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
  }, []);

  const useSimulation = useCallback(() => {
    setMode('mock');
    setUser(null);
    setPermissions({});
  }, []);

  const can = useCallback(
    (capability: string) => {
      if (mode === 'mock') return true; // the simulation grants everything
      if (user?.role === 'admin' && Object.keys(permissions).length === 0) return true;
      return Boolean(permissions[capability]);
    },
    [mode, user, permissions],
  );

  return { mode, user, permissions, elevated, error, busy, signIn, signOut, useSimulation, can };
}

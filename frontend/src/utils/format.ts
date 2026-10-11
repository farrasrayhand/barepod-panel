import { ApiError } from '../api/client';

/** One readable sentence for any thrown value. */
export const describeError = (err: unknown): string => {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Something went wrong';
};

/** Friendly device label from a User-Agent string ("Chrome · macOS"). */
export const describeDevice = (userAgent: string): string => {
  const ua = userAgent || '';
  const browser = /Firefox\//.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl\//i.test(ua)
              ? 'curl'
              : /python-requests|Go-http-client|node-fetch|axios/i.test(ua)
                ? 'API client'
                : '';
  const system = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';

  if (!browser) return ua.trim().slice(0, 40) || 'Unknown device';
  return system ? `${browser} · ${system}` : browser;
};

/** "Active now", "12 minutes ago", "Yesterday", then a date. */
export const timeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 90) return 'Active now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Clock time for an activity line; the full timestamp goes in the title. */
export const clockTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
};

/** Readable sentence for one audit action. */
export const describeAudit = (action: string, target: string, detail: string, username: string): string => {
  const who = username || 'system';
  const at = target ? ` ${target}` : '';
  switch (action) {
    case 'auth.login':
      return `${who} signed in`;
    case 'auth.logout':
      return `${who} signed out`;
    case 'auth.elevate':
      return `${who} re-authenticated for a sensitive action`;
    case 'auth.session_revoke':
      return `${who} revoked a session`;
    case 'website.deploy_start':
      return `${who} started a deploy for${at}`;
    case 'website.start':
      return `${who} started${at}`;
    case 'website.stop':
      return `${who} stopped${at}`;
    case 'website.restart':
      return `${who} restarted${at}`;
    case 'website.delete':
      return `${who} deleted the website${at}`;
    case 'website.redeploy':
      return `${who} redeployed${at}`;
    case 'website.secret_reveal':
      return `${who} revealed a stored credential for${at}`;
    case 'website.directory_prepare':
      return `${who} created the directory for${at}`;
    case 'terminal.open':
      return `${who} opened a terminal for${at}`;
    case 'terminal.close':
      return `${who} closed a terminal for${at}`;
    case 'files.upload':
      return `${who} uploaded files to${at}`;
    case 'files.write':
      return `${who} edited a file in${at}`;
    case 'files.create':
      return `${who} created a file in${at}`;
    case 'files.mkdir':
      return `${who} created a folder in${at}`;
    case 'files.rename':
      return `${who} renamed an entry in${at}`;
    case 'files.move':
      return `${who} moved an entry in${at}`;
    case 'files.copy':
      return `${who} copied an entry in${at}`;
    case 'files.delete':
      return `${who} deleted files in${at}`;
    case 'files.download':
      return `${who} downloaded a file from${at}`;
    case 'files.compress':
      return `${who} downloaded a .zip from${at}`;
    case 'group.update':
      return `${who} changed the limits of${at}`;
    case 'system.capacity_exceeded':
      return detail ? `Capacity check failed: ${detail}` : 'A package exceeds the server capacity';
    default:
      return `${who} ran ${action}${at}`;
  }
};

import React, { useState } from 'react';
import { 
  ShieldAlert, 
  X, 
  Key, 
  Lock, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  AlertCircle,
  Clock
} from 'lucide-react';
import type { DatabaseItem } from '../types';

interface CredentialRevealModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
  /**
   * Live unlock: confirms the panel password and returns the stored credential.
   * Without it the modal keeps its prototype behaviour (any password unlocks a
   * sample value), which is only ever used when no daemon is answering.
   */
  onUnlock?: (panelPassword: string) => Promise<{ user: string; password: string }>;
}

export const CredentialRevealModal: React.FC<CredentialRevealModalProps> = ({
  isOpen,
  onClose,
  database,
  onUnlock,
}) => {
  const [credential, setCredential] = useState<{ user: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelPassword, setPanelPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [autoLockSeconds, setAutoLockSeconds] = useState(60);

  // Reset unlock state whenever a different database is opened
  React.useEffect(() => {
    setIsUnlocked(false);
    setShowPasswordText(false);
    setPanelPassword('');
    setAutoLockSeconds(60);
    setCredential(null);
  }, [database]);

  // Password Vault auto-lock: re-encrypt credential after 60 seconds unlocked
  React.useEffect(() => {
    if (!isUnlocked) return;
    setAutoLockSeconds(60);
    const timer = setInterval(() => {
      setAutoLockSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isUnlocked]);

  React.useEffect(() => {
    if (isUnlocked && autoLockSeconds === 0) {
      setIsUnlocked(false);
      setShowPasswordText(false);
      setPanelPassword('');
      setAutoLockSeconds(60);
    }
  }, [isUnlocked, autoLockSeconds]);

  if (!isOpen || !database) return null;

  // Mock plain passwords for display once unlocked
  const mockPasswords: Record<string, string> = {
    'db-1': 'bp_pg_98f!aA72#xK',
    'db-2': 'analytics_sec_89Qv$L1',
    'db-3': 'mongo_cl_4412$zP9@w',
    'db-4': 'rd_cache_k9921_xOp8#',
    'db-5': 'wp_mysql_pass_8829#',
    'db-6': 'pos_legacy_pwd_771@',
  };

  const actualPassword = credential?.password ?? mockPasswords[database.id] ?? 'barepod_secret_key_889#';
  const actualUser = credential?.user ?? database.username;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!panelPassword.trim()) {
      setErrorMsg('Please enter your panel password.');
      return;
    }
    if (onUnlock) {
      setBusy(true);
      setErrorMsg('');
      try {
        setCredential(await onUnlock(panelPassword));
        setIsUnlocked(true);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'That password was not accepted.');
      } finally {
        setBusy(false);
      }
      return;
    }

    // In a real system, the daemon verifies hash with bcrypt
    // Here any non-empty input unlocks it for demonstration
    setIsUnlocked(true);
    setErrorMsg('');
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleClose = () => {
    setIsUnlocked(false);
    setPanelPassword('');
    setErrorMsg('');
    setShowPasswordText(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              isUnlocked ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {isUnlocked ? <Key className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isUnlocked ? 'Database Credentials' : 'Authentication Required'}
              </h2>
              <p className="text-xs text-slate-500">
                {isUnlocked ? `Decrypted credentials for ${database.name}` : 'Verify identity to view sensitive credentials'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {!isUnlocked ? (
          /* Step 1: Prompt for Panel Password */
          <form onSubmit={handleUnlock} className="p-6 space-y-4">
            <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Security Protection:</span>
                <p className="mt-0.5 text-amber-800">
                  Database passwords are hidden to prevent data theft. Enter your <strong>BarePod Panel Account Password</strong> to reveal this database password.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Your Panel Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  autoFocus
                  required
                  placeholder="Enter your panel login password..."
                  value={panelPassword}
                  onChange={(e) => setPanelPassword(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              {errorMsg && (
                <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errorMsg}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-500/20"
              >
                Unlock & Reveal
              </button>
            </div>
          </form>
        ) : (
          /* Step 2: Unlocked Credentials Revealed */
          <div className="p-6 space-y-4">
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
              <span className="flex items-center gap-1.5 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-600" /> Identity Verified
              </span>
              <span className="text-[10px] text-emerald-700 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Auto-locks in {autoLockSeconds}s
              </span>
            </div>

            {/* Credential Fields */}
            <div className="space-y-3 text-xs">
              {/* Host & Port */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Host / Port</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-slate-800 font-medium">
                    127.0.0.1 : {database.type === 'postgres' ? '5432' : database.type === 'mongodb' ? '27017' : database.type === 'redis' ? '6379' : '3306'}
                  </span>
                  <button
                    onClick={() => handleCopy('127.0.0.1', 'host')}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    {copiedField === 'host' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Database Name */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Database Name</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-slate-800 font-medium">{database.name}</span>
                  <button
                    onClick={() => handleCopy(database.name, 'name')}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    {copiedField === 'name' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Username */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-400 font-semibold uppercase">Username</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-slate-800 font-medium">{actualUser}</span>
                  <button
                    onClick={() => handleCopy(actualUser, 'user')}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    {copiedField === 'user' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Password (The requested feature) */}
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase">
                  <span>Database Password</span>
                  <button 
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 font-normal"
                  >
                    {showPasswordText ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{showPasswordText ? 'Hide' : 'Reveal'}</span>
                  </button>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-slate-900 font-bold tracking-wider">
                    {showPasswordText ? actualPassword : '••••••••••••••••'}
                  </span>
                  <button
                    onClick={() => handleCopy(actualPassword, 'pwd')}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    {copiedField === 'pwd' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Done & Lock Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

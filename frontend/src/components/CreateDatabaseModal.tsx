import React, { useState } from 'react';
import { X, Database, Key, ShieldCheck, Sparkles, Check } from 'lucide-react';
import type { DatabaseEngine, DatabaseItem } from '../types';

interface CreateDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (db: DatabaseItem) => void;
}

export const CreateDatabaseModal: React.FC<CreateDatabaseModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseEngine>('postgres');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('bp_sec_' + Math.random().toString(36).substring(2, 9));

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const versionMap: Record<DatabaseEngine, string> = {
      postgres: 'PostgreSQL 16.4',
      mysql: 'MariaDB 11.2',
      mariadb: 'MariaDB 11.2',
      mongodb: 'MongoDB 7.0.8',
      redis: 'Redis 7.2.4',
    };

    const newDb: DatabaseItem = {
      id: `db-${Date.now()}`,
      name: name.toLowerCase().replace(/\s+/g, '_'),
      type,
      version: versionMap[type],
      username: username.trim() || `${name.toLowerCase()}_user`,
      size: '0 B',
      charset: type === 'mongodb' ? 'BSON' : type === 'redis' ? 'In-Memory' : 'UTF8',
      status: 'active',
      connections: 1,
    };

    onCreate(newDb);
    onClose();
    setName('');
    setUsername('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Provision New Database</h2>
              <p className="text-xs text-slate-500">PostgreSQL, MariaDB, MongoDB, or Redis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Engine Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Select Database Engine
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'postgres' as DatabaseEngine, label: '🐘 PostgreSQL 16' },
                { id: 'mysql' as DatabaseEngine, label: '🐬 MariaDB / MySQL' },
                { id: 'mongodb' as DatabaseEngine, label: '🍃 MongoDB 7' },
                { id: 'redis' as DatabaseEngine, label: '🔴 Redis Cache' },
              ].map((engine) => (
                <button
                  type="button"
                  key={engine.id}
                  onClick={() => setType(engine.id)}
                  className={`p-2.5 rounded-xl border text-xs text-left transition-all ${
                    type === engine.id
                      ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold ring-2 ring-blue-500/10'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                  }`}
                >
                  {engine.label}
                </button>
              ))}
            </div>
          </div>

          {/* Database Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Database Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. ecommerce_db"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Database Username (Optional)
            </label>
            <input
              type="text"
              placeholder="Leave empty for auto-generated user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          {/* Generated Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Generated Password</label>
              <button
                type="button"
                onClick={() => setPassword('bp_sec_' + Math.random().toString(36).substring(2, 10))}
                className="text-[10px] text-blue-600 hover:underline"
              >
                Regenerate
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={password}
                className="w-full px-3 py-2 text-xs bg-slate-100 border border-slate-200 rounded-lg font-mono text-slate-700"
              />
            </div>
          </div>

          {/* SSO Info */}
          <div className="p-3 bg-blue-50/70 border border-blue-200/60 rounded-xl text-xs text-blue-900 flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-800">
              Database ini otomatis dapat diakses langsung via <strong>Web GUI (SSO)</strong> tanpa perlu login manual lagi.
            </p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-500/20"
            >
              Create Database
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

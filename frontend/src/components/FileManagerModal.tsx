import React, { useState } from 'react';
import { 
  Folder, 
  File, 
  FileCode, 
  FileText, 
  Upload, 
  Plus, 
  Trash2, 
  Download, 
  Save, 
  X, 
  ChevronRight, 
  RotateCw, 
  Check, 
  Edit3,
  Archive,
  Terminal,
  ShieldCheck,
  Maximize2
} from 'lucide-react';
import type { WebApp } from '../types';

interface FileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
}

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  size: string;
  modified: string;
  permissions: string;
  content?: string;
}

export const FileManagerModal: React.FC<FileManagerModalProps> = ({
  isOpen,
  onClose,
  app,
}) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen || !app) return null;

  const mockFiles: Record<string, FileEntry[]> = {
    '/': [
      { name: '.env', type: 'file', size: '420 B', modified: 'Oct 10 16:30', permissions: '0600', content: `APP_NAME="${app.name}"\nAPP_ENV=production\nAPP_KEY=base64:X8fJk88219PqLo01...\nAPP_DEBUG=false\nAPP_URL="https://${app.domain}"\n\nDB_CONNECTION=pgsql\nDB_HOST=127.0.0.1\nDB_PORT=5432\nDB_DATABASE=app_production\nDB_USERNAME=barepod_user\nDB_PASSWORD=secret_password\n\nREDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n` },
      { name: 'app', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:20', permissions: '0755' },
      { name: 'config', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:15', permissions: '0755' },
      { name: 'public', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:25', permissions: '0755' },
      { name: 'routes', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:10', permissions: '0755' },
      { name: 'storage', type: 'folder', size: '12.4 MB', modified: 'Oct 10 16:35', permissions: '0775' },
      { name: 'composer.json', type: 'file', size: '1.8 KB', modified: 'Oct 10 16:05', permissions: '0644', content: `{\n  "name": "barepod/${app.name}",\n  "type": "project",\n  "require": {\n    "php": "^8.2",\n    "laravel/framework": "^11.0"\n  }\n}` },
      { name: 'package.json', type: 'file', size: '840 B', modified: 'Oct 10 16:05', permissions: '0644', content: `{\n  "name": "${app.name}",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}` },
      { name: 'README.md', type: 'file', size: '1.2 KB', modified: 'Oct 10 16:00', permissions: '0644', content: `# ${app.name}\nDeployed on BarePod Panel with isolated runtime.` },
    ],
    '/public': [
      { name: 'index.php', type: 'file', size: '1.2 KB', modified: 'Oct 10 16:25', permissions: '0644', content: `<?php\n\ndefine('LARAVEL_START', microtime(true));\n\nrequire __DIR__.'/../vendor/autoload.php';\n\n$app = require_once __DIR__.'/../bootstrap/app.php';\n\n$kernel = $app->make(Illuminate\\Contracts\\Http\\Kernel::class);\n$response = $kernel->handle(\n    $request = Illuminate\\Http\\Request::capture()\n)->send();\n\n$kernel->terminate($request, $response);\n` },
      { name: '.htaccess', type: 'file', size: '520 B', modified: 'Oct 10 16:20', permissions: '0644', content: `<IfModule mod_rewrite.c>\n    RewriteEngine On\n    RewriteCond %{REQUEST_FILENAME} !-d\n    RewriteCond %{REQUEST_FILENAME} !-f\n    RewriteRule ^ index.php [L]\n</IfModule>` },
      { name: 'robots.txt', type: 'file', size: '48 B', modified: 'Oct 10 16:00', permissions: '0644', content: 'User-agent: *\nDisallow:' },
    ]
  };

  const filesInPath = mockFiles[currentPath] || mockFiles['/'];

  const handleOpenFile = (file: FileEntry) => {
    if (file.type === 'folder') {
      setCurrentPath(currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    } else {
      setEditingFile(file);
      setEditorContent(file.content || `// Content of ${file.name}\n`);
    }
  };

  const handleSaveFile = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 1500);
  };

  const getFileIcon = (file: FileEntry) => {
    if (file.type === 'folder') return <Folder className="w-4 h-4 text-amber-500 fill-amber-100" />;
    if (file.name.endsWith('.php') || file.name.endsWith('.py') || file.name.endsWith('.js') || file.name.endsWith('.json')) {
      return <FileCode className="w-4 h-4 text-blue-500" />;
    }
    if (file.name.startsWith('.env')) return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full h-[88vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">File Manager — {app.name}</span>
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                  /home/{app.tenantUser}/apps/{app.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Persistent Container Volume Mount • Host Sync Active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Breadcrumb Path */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-mono">
            <button 
              onClick={() => setCurrentPath('/')}
              className="hover:text-blue-600 font-bold"
            >
              root
            </button>
            {currentPath !== '/' && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-800 font-semibold">{currentPath.replace('/', '')}</span>
              </>
            )}
          </div>

          {/* Quick Buttons */}
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium">
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              <span>Upload Files</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium">
              <Plus className="w-3.5 h-3.5 text-slate-500" />
              <span>New File</span>
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium">
              <Archive className="w-3.5 h-3.5 text-slate-500" />
              <span>Unzip Archive</span>
            </button>
          </div>
        </div>

        {/* Main Content: Split / Editor */}
        <div className="flex-1 flex min-h-0 bg-slate-50">
          {/* File List Grid / Table */}
          <div className={`${editingFile ? 'w-1/2 hidden md:block' : 'w-full'} border-r border-slate-200 bg-white overflow-y-auto`}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-500 text-[11px] sticky top-0">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Size</th>
                  <th className="py-2.5 px-4">Permissions</th>
                  <th className="py-2.5 px-4">Last Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentPath !== '/' && (
                  <tr 
                    onClick={() => setCurrentPath('/')}
                    className="hover:bg-slate-50 cursor-pointer font-medium text-slate-600"
                  >
                    <td colSpan={4} className="py-2 px-4 flex items-center gap-2">
                      <Folder className="w-4 h-4 text-slate-400" />
                      <span>.. (Back to root)</span>
                    </td>
                  </tr>
                )}
                {filesInPath.map((file, idx) => (
                  <tr
                    key={idx}
                    onClick={() => handleOpenFile(file)}
                    className="hover:bg-blue-50/60 cursor-pointer transition-colors group"
                  >
                    <td className="py-2.5 px-4 font-mono">
                      <div className="flex items-center gap-2.5">
                        {getFileIcon(file)}
                        <span className={`font-medium ${file.type === 'folder' ? 'text-slate-900 font-semibold' : 'text-slate-700'}`}>
                          {file.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">{file.size}</td>
                    <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">{file.permissions}</td>
                    <td className="py-2.5 px-4 text-slate-400 text-[11px]">{file.modified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Code Editor Panel */}
          {editingFile ? (
            <div className="flex-1 flex flex-col bg-slate-900 text-slate-100 overflow-hidden">
              {/* Editor Bar */}
              <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <FileCode className="w-4 h-4 text-blue-400" />
                  <span className="font-bold text-white">{editingFile.name}</span>
                  <span className="text-[10px] text-slate-500">({editingFile.size})</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveFile}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                  >
                    {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
                  </button>
                  <button
                    onClick={() => setEditingFile(null)}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Close Editor"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Text Area Code Editor */}
              <div className="flex-1 p-4 font-mono text-xs overflow-auto">
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full h-full bg-transparent border-none outline-hidden text-emerald-300 resize-none font-mono text-xs leading-relaxed focus:ring-0"
                />
              </div>
            </div>
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center p-8 text-center text-slate-400">
              <div>
                <Edit3 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-medium text-slate-600">Click any file to edit in the built-in Web Code Editor</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Supports instant editing for .env, PHP, Python, JS, and config files</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

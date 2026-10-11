import React, { useState, useEffect, useRef } from 'react';
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
  Maximize2,
  Image as ImageIcon,
  FileCheck,
  Copy,
  Scissors,
  Clipboard,
  Move,
  Eye,
  FolderPlus,
  ZoomIn,
  ZoomOut,
  ExternalLink,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import type { WebApp } from '../types';
import { api, apiReachable, ApiError, type FileEntry as ApiFileEntry } from '../api/client';
import { createZip } from '../utils/zip';
import { highlightCode } from '../utils/highlight';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';
import 'highlight.js/styles/github-dark.css';

interface FileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
  inline?: boolean;
}

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  size: string;
  modified: string;
  permissions: string;
  /** Path relative to the site root, as the daemon expects it (live mode). */
  apiPath?: string;
  /** Authenticated download URL, used for previews (live mode). */
  previewUrl?: string;
  /** Simulation mode only. */
  content?: string;
  mediaType?: 'text' | 'image' | 'pdf' | 'audio' | 'video';
  symlinkTarget?: string;
}

interface ClipboardState {
  files: FileEntry[];
  operation: 'copy' | 'cut';
  sourcePath: string;
}

const detectMediaType = (fileName: string): 'text' | 'image' | 'pdf' | 'audio' | 'video' => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico'].includes(ext || '')) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'wav', 'ogg'].includes(ext || '')) return 'audio';
  if (['mp4', 'webm'].includes(ext || '')) return 'video';
  return 'text';
};

const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
};

const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** UI path ("/public") → daemon path ("public"). */
const toApiPath = (uiPath: string): string => uiPath.replace(/^\/+/, '').replace(/\/+$/, '');
/** Child UI path. */
const joinUiPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`);
/** Child daemon path. */
const joinApiPath = (dir: string, name: string): string => {
  const parent = toApiPath(dir);
  return parent ? `${parent}/${name}` : name;
};
const parentUiPath = (uiPath: string): string => {
  const parts = uiPath.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
};

const describeError = (err: unknown): string => {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Something went wrong';
};

const toEntry = (item: ApiFileEntry, slug: string): FileEntry => {
  const isFolder = item.type === 'directory';
  return {
    name: item.name,
    type: isFolder ? 'folder' : 'file',
    size: isFolder ? '—' : formatSize(item.size),
    modified: formatWhen(item.modifiedAt),
    permissions: item.mode,
    apiPath: item.path,
    previewUrl: isFolder ? undefined : api.downloadUrl(slug, item.path),
    mediaType: detectMediaType(item.name),
    symlinkTarget: item.symlinkTarget,
  };
};

export const FileManagerModal: React.FC<FileManagerModalProps> = ({
  isOpen,
  onClose,
  app,
  inline = false,
}) => {
  const slug = app?.name ?? '';

  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorEncoding, setEditorEncoding] = useState<'utf-8' | 'base64'>('utf-8');
  const [editorNote, setEditorNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const editorPreRef = useRef<HTMLPreElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { size: panelSize, height: panelHeight, setSize: setPanelSize } = usePanelSize({ sm: 420, md: 600, lg: 820 });

  // Real files (daemon reachable) or the prototype's mock tree.
  const [live, setLive] = useState<boolean | null>(null);
  const [liveEntries, setLiveEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  // Clipboard State (Copy, Cut, Paste)
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileEntry | null } | null>(null);

  // Modal Dialogs for File Operations
  const [renameModal, setRenameModal] = useState<{ isOpen: boolean; file: FileEntry | null; newName: string }>({
    isOpen: false,
    file: null,
    newName: ''
  });
  const [newFileModal, setNewFileModal] = useState<{ isOpen: boolean; name: string }>({
    isOpen: false,
    name: ''
  });
  const [newFolderModal, setNewFolderModal] = useState<{ isOpen: boolean; name: string }>({
    isOpen: false,
    name: ''
  });
  const [previewModal, setPreviewModal] = useState<{ isOpen: boolean; file: FileEntry | null; zoom: number }>({
    isOpen: false,
    file: null,
    zoom: 1
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Sample SVG for image preview in simulation mode
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="100%" height="100%">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2563eb" />
        <stop offset="100%" stop-color="#7c3aed" />
      </linearGradient>
    </defs>
    <rect width="400" height="240" rx="16" fill="url(#grad)" />
    <circle cx="200" cy="90" r="45" fill="#ffffff" opacity="0.15" />
    <path d="M175 105 L200 65 L225 105 Z" fill="#ffffff" />
    <text x="200" y="155" fill="#ffffff" font-family="system-ui, sans-serif" font-weight="bold" font-size="20" text-anchor="middle">BarePod Cloud Assets</text>
    <text x="200" y="180" fill="#93c5fd" font-family="monospace" font-size="12" text-anchor="middle">Vector Graphic • Scalable Production Asset</text>
  </svg>`;

  // Simulation file tree — only used when the daemon does not answer.
  const [mockFs, setMockFs] = useState<Record<string, FileEntry[]>>({});

  useEffect(() => {
    if (!app) return;
    setMockFs({
      '/': [
        { name: '.env', type: 'file', size: '420 B', modified: 'Oct 10 16:30', permissions: '0600', mediaType: 'text', content: `APP_NAME="${app.name}"\nAPP_ENV=production\nAPP_KEY=base64:X8fJk88219PqLo01...\nAPP_DEBUG=false\nAPP_URL="https://${app.domain}"\n\nDB_CONNECTION=pgsql\nDB_HOST=127.0.0.1\nDB_PORT=5432\nDB_DATABASE=app_production\nDB_USERNAME=barepod_user\nDB_PASSWORD=secret_password\n\nREDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n` },
        { name: 'app', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:20', permissions: '0755' },
        { name: 'config', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:15', permissions: '0755' },
        { name: 'public', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:25', permissions: '0755' },
        { name: 'routes', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:10', permissions: '0755' },
        { name: 'storage', type: 'folder', size: '12.4 MB', modified: 'Oct 10 16:35', permissions: '0775' },
        { name: 'composer.json', type: 'file', size: '1.8 KB', modified: 'Oct 10 16:05', permissions: '0644', mediaType: 'text', content: `{\n  "name": "barepod/${app.name}",\n  "type": "project",\n  "require": {\n    "php": "^8.2",\n    "laravel/framework": "^11.0"\n  }\n}` },
        { name: 'package.json', type: 'file', size: '840 B', modified: 'Oct 10 16:05', permissions: '0644', mediaType: 'text', content: `{\n  "name": "${app.name}",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}` },
        { name: 'README.md', type: 'file', size: '1.2 KB', modified: 'Oct 10 16:00', permissions: '0644', mediaType: 'text', content: `# ${app.name}\nDeployed on BarePod Panel with isolated runtime.` },
        { name: 'logo.svg', type: 'file', size: '4.2 KB', modified: 'Oct 10 15:45', permissions: '0644', mediaType: 'image', content: sampleSvg },
        { name: 'app-spec.pdf', type: 'file', size: '240 KB', modified: 'Oct 10 15:30', permissions: '0644', mediaType: 'pdf' },
      ],
      '/public': [
        { name: 'index.php', type: 'file', size: '1.2 KB', modified: 'Oct 10 16:25', permissions: '0644', mediaType: 'text', content: `<?php\n\ndefine('LARAVEL_START', microtime(true));\n\nrequire __DIR__.'/../vendor/autoload.php';\n\n$app = require_once __DIR__.'/../bootstrap/app.php';\n\n$kernel = $app->make(Illuminate\\Contracts\\Http\\Kernel::class);\n$response = $kernel->handle(\n    $request = Illuminate\\Http\\Request::capture()\n)->send();\n\n$kernel->terminate($request, $response);\n` },
        { name: '.htaccess', type: 'file', size: '520 B', modified: 'Oct 10 16:20', permissions: '0644', mediaType: 'text', content: `<IfModule mod_rewrite.c>\n    RewriteEngine On\n    RewriteCond %{REQUEST_FILENAME} !-d\n    RewriteCond %{REQUEST_FILENAME} !-f\n    RewriteRule ^ index.php [L]\n</IfModule>` },
        { name: 'robots.txt', type: 'file', size: '48 B', modified: 'Oct 10 16:00', permissions: '0644', mediaType: 'text', content: 'User-agent: *\nDisallow:' },
        { name: 'hero-banner.svg', type: 'file', size: '5.8 KB', modified: 'Oct 10 15:50', permissions: '0644', mediaType: 'image', content: sampleSvg },
        { name: 'invoice-sample.pdf', type: 'file', size: '185 KB', modified: 'Oct 10 15:40', permissions: '0644', mediaType: 'pdf' },
      ]
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.name]);

  // Is the daemon answering? The prototype keeps working on mock files when not.
  useEffect(() => {
    let cancelled = false;
    apiReachable()
      .then((ok) => { if (!cancelled) setLive(ok); })
      .catch(() => { if (!cancelled) setLive(false); });
    return () => { cancelled = true; };
  }, []);

  // The real listing: one call per directory change.
  useEffect(() => {
    if (live !== true || !slug) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .files(slug, toApiPath(currentPath))
      .then((res) => { if (!cancelled) setLiveEntries(res.items.map((item) => toEntry(item, slug))); })
      .catch((err) => { if (!cancelled) setError(describeError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [live, slug, currentPath, reloadKey]);

  // Close context menu on outside click
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  if (!app || (!isOpen && !inline)) return null;

  const currentFiles = live ? liveEntries : mockFs[currentPath] || [];

  const handleOpenFile = async (file: FileEntry) => {
    if (file.type === 'folder') {
      setCurrentPath(joinUiPath(currentPath, file.name));
      setSelectedFile(null);
      setSelectedFiles([]);
      return;
    }
    const media = file.mediaType || detectMediaType(file.name);
    if (media !== 'text') {
      setPreviewModal({ isOpen: true, file, zoom: 1 });
      return;
    }
    setEditingFile(file);
    setEditorNote('');
    setEditorEncoding('utf-8');
    if (!live) {
      setEditorContent(file.content || `// Content of ${file.name}\n// Path: ${currentPath}/${file.name}\n`);
      return;
    }
    setBusy(true);
    try {
      const result = await api.readFile(slug, file.apiPath ?? '');
      setEditorEncoding(result.encoding);
      setEditorContent(result.content ?? '');
      if (result.binary) {
        setEditorNote('This file is binary, so it is shown as base64 and saved back the same way.');
      }
    } catch (err) {
      setError(describeError(err));
      setEditingFile(null);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedFiles(currentFiles.map(f => f.name));
    } else {
      setSelectedFiles([]);
    }
  };

  const handleToggleSelectFile = (fileName: string, checked: boolean) => {
    setSelectedFiles(prev =>
      checked ? [...prev, fileName] : prev.filter(name => name !== fileName)
    );
  };

  const triggerDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownload = (file: FileEntry) => {
    if (live && file.apiPath !== undefined) {
      // The daemon sets Content-Disposition; the cookie authenticates it.
      triggerDownload(api.downloadUrl(slug, file.apiPath), file.name);
      showToast(`Downloading ${file.name}`);
      return;
    }
    const content = file.content || `// Content of ${file.name}\n// Exported from BarePod Panel\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, file.name);
    URL.revokeObjectURL(url);
    showToast(`Downloading ${file.name}`);
  };

  const handleDownloadSelected = async () => {
    if (selectedFiles.length === 0) return;
    const chosen = selectedFiles
      .map(fileName => currentFiles.find(item => item.name === fileName))
      .filter((f): f is FileEntry => Boolean(f));

    if (live) {
      const paths = chosen.map((f) => f.apiPath ?? '').filter(Boolean);
      if (paths.length === 1) {
        handleDownload(chosen[0]);
        return;
      }
      setBusy(true);
      try {
        const blob = await api.compressFiles(slug, paths);
        const url = URL.createObjectURL(blob);
        triggerDownload(url, `${app.name}-selection.zip`);
        URL.revokeObjectURL(url);
        showToast(`Downloading ${paths.length} items as a .zip archive`);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    if (chosen.length === 1) {
      handleDownload(chosen[0]);
      return;
    }
    const blob = createZip(chosen.map(f => ({
      name: f.name,
      content: f.content ?? `// Content of ${f.name}\n// Exported from BarePod Panel\n`,
    })));
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${app?.name || 'files'}-export.zip`);
    URL.revokeObjectURL(url);
    showToast(`Downloading ${chosen.length} files as a .zip archive`);
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    if (live && editingFile.apiPath !== undefined) {
      setBusy(true);
      try {
        await api.writeFile(slug, editingFile.apiPath, editorContent, editorEncoding);
        setIsSaved(true);
        showToast(`Saved ${editingFile.name}`);
        reload();
        setTimeout(() => setIsSaved(false), 1500);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setMockFs(prev => {
      const list = prev[currentPath] || [];
      return {
        ...prev,
        [currentPath]: list.map(f => f.name === editingFile.name ? { ...f, content: editorContent } : f)
      };
    });
    setIsSaved(true);
    showToast(`Saved ${editingFile.name}`);
    setTimeout(() => setIsSaved(false), 1500);
  };

  // Clipboard Actions (supports single selection & multi-select / Select All)
  const getSelectedEntries = (): FileEntry[] => {
    if (selectedFiles.length > 0) {
      return currentFiles.filter(f => selectedFiles.includes(f.name));
    }
    return selectedFile ? [selectedFile] : [];
  };

  const resolveUniqueName = (name: string, taken: string[]): string => {
    if (!taken.includes(name)) return name;
    const parts = name.split('.');
    if (parts.length > 1) {
      const ext = parts.pop();
      return `${parts.join('.')}_copy.${ext}`;
    }
    return `${name}_copy`;
  };

  const handleCopy = (files: FileEntry[]) => {
    if (files.length === 0) return;
    setClipboard({ files, operation: 'copy', sourcePath: currentPath });
    showToast(files.length === 1
      ? `Copied to clipboard: ${files[0].name}`
      : `${files.length} items copied to clipboard`);
  };

  const handleCut = (files: FileEntry[]) => {
    if (files.length === 0) return;
    setClipboard({ files, operation: 'cut', sourcePath: currentPath });
    showToast(files.length === 1
      ? `Cut to clipboard: ${files[0].name}`
      : `${files.length} items ready to move (cut)`);
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;
    const { files, operation } = clipboard;

    if (live) {
      setBusy(true);
      try {
        const taken = currentFiles.map((f) => f.name);
        for (const file of files) {
          const targetName = resolveUniqueName(file.name, taken);
          taken.push(targetName);
          const to = joinApiPath(currentPath, targetName);
          if (operation === 'copy') {
            await api.copyFiles(slug, file.apiPath ?? '', to);
          } else {
            await api.moveFiles(slug, file.apiPath ?? '', to);
          }
        }
        showToast(operation === 'copy'
          ? `${files.length} items pasted into ${currentPath}`
          : `${files.length} items moved to ${currentPath}`);
        if (operation === 'cut') setClipboard(null);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    const { sourcePath } = clipboard;
    const movingNames = files.map(f => f.name);

    setMockFs(prev => {
      const currentList = [...(prev[currentPath] || [])];
      const added: FileEntry[] = [];
      files.forEach(file => {
        const targetName = resolveUniqueName(file.name, [...currentList, ...added].map(f => f.name));
        added.push({ ...file, name: targetName, modified: 'Just now' });
      });

      const next: Record<string, FileEntry[]> = {
        ...prev,
        [currentPath]: [...currentList, ...added],
      };

      if (operation === 'cut') {
        if (sourcePath === currentPath) {
          next[currentPath] = next[currentPath].filter(f => !movingNames.includes(f.name));
        } else {
          next[sourcePath] = (prev[sourcePath] || []).filter(f => !movingNames.includes(f.name));
        }
      }

      return next;
    });

    showToast(operation === 'copy'
      ? `${files.length} items pasted into ${currentPath}`
      : `${files.length} items moved to ${currentPath}`);
    if (operation === 'cut') setClipboard(null);
  };

  const handleDelete = async (file: FileEntry) => {
    if (live) {
      setBusy(true);
      try {
        await api.deleteFiles(slug, [file.apiPath ?? '']);
        showToast(`Deleted ${file.name}`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setMockFs(prev => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).filter(f => f.name !== file.name)
    }));
    if (selectedFile?.name === file.name) setSelectedFile(null);
    if (editingFile?.name === file.name) setEditingFile(null);
    setSelectedFiles(prev => prev.filter(n => n !== file.name));
    showToast(`File ${file.name} deleted.`);
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.length === 0) return;
    const count = selectedFiles.length;

    if (live) {
      const paths = currentFiles
        .filter((f) => selectedFiles.includes(f.name))
        .map((f) => f.apiPath ?? '')
        .filter(Boolean);
      setBusy(true);
      try {
        await api.deleteFiles(slug, paths);
        setSelectedFiles([]);
        setSelectedFile(null);
        showToast(`${count} items deleted.`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs(prev => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).filter(f => !selectedFiles.includes(f.name))
    }));
    if (selectedFile && selectedFiles.includes(selectedFile.name)) setSelectedFile(null);
    if (editingFile && selectedFiles.includes(editingFile.name)) setEditingFile(null);
    setSelectedFiles([]);
    showToast(`${count} items deleted.`);
  };

  const handleDuplicate = async (file: FileEntry) => {
    const newName = resolveUniqueName(file.name, currentFiles.map(f => f.name));

    if (live) {
      setBusy(true);
      try {
        await api.copyFiles(slug, file.apiPath ?? '', joinApiPath(currentPath, newName));
        showToast(`Duplicated as ${newName}`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs(prev => ({
      ...prev,
      [currentPath]: [...(prev[currentPath] || []), { ...file, name: newName, modified: 'Just now' }]
    }));
    showToast(`Duplicated ${newName}`);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameModal.file || !renameModal.newName.trim()) return;
    const newName = renameModal.newName.trim();
    const target = renameModal.file;

    if (live) {
      setBusy(true);
      try {
        await api.renameFile(slug, target.apiPath ?? '', newName);
        showToast(`Renamed to ${newName}`);
        setRenameModal({ isOpen: false, file: null, newName: '' });
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs(prev => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).map(f => f.name === target.name ? { ...f, name: newName } : f)
    }));
    showToast(`Renamed to ${newName}`);
    setRenameModal({ isOpen: false, file: null, newName: '' });
  };

  const handleCreateFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileModal.name.trim()) return;
    const name = newFileModal.name.trim();

    if (live) {
      setBusy(true);
      try {
        await api.createFile(slug, joinApiPath(currentPath, name));
        setNewFileModal({ isOpen: false, name: '' });
        showToast(`Created ${name}`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs(prev => ({
      ...prev,
      [currentPath]: [...(prev[currentPath] || []), {
        name,
        type: 'file',
        size: '0 B',
        modified: 'Just now',
        permissions: '0644',
        mediaType: detectMediaType(name),
        content: ''
      }]
    }));
    setNewFileModal({ isOpen: false, name: '' });
    showToast(`File ${name} created.`);
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderModal.name.trim()) return;
    const name = newFolderModal.name.trim();

    if (live) {
      setBusy(true);
      try {
        await api.mkdir(slug, joinApiPath(currentPath, name));
        setNewFolderModal({ isOpen: false, name: '' });
        showToast(`Created folder ${name}`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs(prev => ({
      ...prev,
      [currentPath]: [...(prev[currentPath] || []), {
        name,
        type: 'folder',
        size: '4.0 KB',
        modified: 'Just now',
        permissions: '0755'
      }]
    }));
    setNewFolderModal({ isOpen: false, name: '' });
    showToast(`Folder ${name} created.`);
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setBusy(true);
    setError('');
    try {
      const result = await api.uploadFiles(slug, toApiPath(currentPath), files);
      showToast(`Uploaded ${result.uploaded.length} file${result.uploaded.length === 1 ? '' : 's'}`);
      reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const getFileIcon = (file: FileEntry) => {
    if (file.type === 'folder') return <Folder className="w-4 h-4 text-amber-500 fill-amber-100 shrink-0" />;
    const media = file.mediaType || detectMediaType(file.name);
    if (media === 'image') return <ImageIcon className="w-4 h-4 text-purple-500 shrink-0" />;
    if (media === 'pdf') return <FileCheck className="w-4 h-4 text-rose-500 shrink-0" />;
    if (file.name.endsWith('.php') || file.name.endsWith('.py') || file.name.endsWith('.js') || file.name.endsWith('.json')) {
      return <FileCode className="w-4 h-4 text-blue-500 shrink-0" />;
    }
    if (file.name.startsWith('.env')) return <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />;
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  const breadcrumbSegments = currentPath.split('/').filter(Boolean);

  return (
    <div className={inline ? 'block' : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200'}>
      <div
        className={inline
          ? 'bg-white rounded-2xl border border-slate-200 shadow-2xs w-full flex flex-col overflow-hidden relative'
          : 'bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-6xl w-full h-[90vh] flex flex-col overflow-hidden relative'}
        style={inline ? { height: panelHeight } : undefined}
      >

        {/* Toast Notification */}
        {toastMessage && (
          <div className="absolute top-16 right-6 z-50 px-4 py-2 bg-slate-900 text-white rounded-xl shadow-lg border border-slate-700 text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

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
                {live === true && (
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded font-semibold">
                    Live
                  </span>
                )}
                {live === false && (
                  <span className="text-[10px] bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded font-semibold">
                    Simulation (mock data)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {live === true
                  ? 'Files on the host, read and written as the tenant account'
                  : 'No daemon on this machine — showing mock files'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
              onClick={() => {
                setCurrentPath('/');
                setSelectedFile(null);
                setSelectedFiles([]);
              }}
              className="hover:text-blue-600 font-bold cursor-pointer"
            >
              root
            </button>
            {breadcrumbSegments.map((segment, index) => {
              const target = `/${breadcrumbSegments.slice(0, index + 1).join('/')}`;
              const isLast = index === breadcrumbSegments.length - 1;
              return (
                <React.Fragment key={target}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  <button
                    onClick={() => {
                      setCurrentPath(target);
                      setSelectedFile(null);
                      setSelectedFiles([]);
                    }}
                    className={isLast ? 'text-slate-800 font-semibold' : 'hover:text-blue-600'}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Action Buttons Toolbar */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={reload}
              disabled={live !== true}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
              title="Reload this directory"
            >
              {loading && live === true ? <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" /> : <RotateCw className="w-3.5 h-3.5 text-slate-500" />}
              <span>Refresh</span>
            </button>

            {live === true && (
              <button
                onClick={() => uploadInputRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
                title="Upload files into this directory"
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
                <span>Upload</span>
              </button>
            )}

            {/* Batch Selection Banner & Actions */}
            {selectedFiles.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1 rounded-lg text-xs font-semibold">
                  <Check className="w-3.5 h-3.5 text-blue-600" />
                  <span>{selectedFiles.length} selected</span>
                  <button
                    onClick={() => setSelectedFiles([])}
                    className="ml-1 text-slate-500 hover:text-slate-900 text-[10px] underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>

                <button
                  onClick={handleDownloadSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
                  title="Download selected files"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Download ({selectedFiles.length})</span>
                </button>

                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg text-xs font-semibold cursor-pointer"
                  title="Delete all selected"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Delete ({selectedFiles.length})</span>
                </button>

                <div className="h-4 w-px bg-slate-200 mx-1" />
              </>
            )}

            <button
              onClick={() => setNewFileModal({ isOpen: true, name: '' })}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              <span>New File</span>
            </button>

            <button
              onClick={() => setNewFolderModal({ isOpen: true, name: '' })}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
              <span>New Folder</span>
            </button>

            <div className="h-4 w-px bg-slate-200 mx-1" />

            {/* Clipboard Toolbar Buttons */}
            <button
              disabled={!selectedFile && selectedFiles.length === 0}
              onClick={() => handleCopy(getSelectedEntries())}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
              title="Copy Selected File(s)"
            >
              <Copy className="w-3.5 h-3.5 text-slate-600" />
              <span>Copy{selectedFiles.length > 1 ? ` (${selectedFiles.length})` : ''}</span>
            </button>

            <button
              disabled={!selectedFile && selectedFiles.length === 0}
              onClick={() => handleCut(getSelectedEntries())}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-white rounded-lg text-xs text-slate-700 shadow-2xs font-medium cursor-pointer"
              title="Cut Selected File(s)"
            >
              <Scissors className="w-3.5 h-3.5 text-slate-600" />
              <span>Cut{selectedFiles.length > 1 ? ` (${selectedFiles.length})` : ''}</span>
            </button>

            <button
              disabled={!clipboard || clipboard.files.length === 0}
              onClick={handlePaste}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-2xs cursor-pointer transition-colors ${
                clipboard
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-white border border-slate-200 text-slate-400 opacity-40'
              }`}
              title={clipboard ? `Paste ${clipboard.files.length} items into ${currentPath}` : 'Clipboard empty'}
            >
              <Clipboard className="w-3.5 h-3.5" />
              <span>Paste {clipboard ? `(${clipboard.files.length})` : ''}</span>
            </button>

            {selectedFile && selectedFiles.length === 0 && (
              <button
                onClick={() => handleDelete(selectedFile)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg text-xs font-medium cursor-pointer"
                title="Delete selected file"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center gap-2 shrink-0">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-800 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files)}
        />

        {/* Main Content Area: Split File Table & Code Editor */}
        <div className="flex-1 flex min-h-0 bg-slate-50">
          {/* File List Grid / Table */}
          <div
            className={`${editingFile ? 'w-1/2 hidden md:block' : 'w-full'} border-r border-slate-200 bg-white overflow-y-auto select-none`}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, file: null });
            }}
          >
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-500 text-[11px] sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={currentFiles.length > 0 && selectedFiles.length === currentFiles.length}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer accent-blue-600"
                      title="Select all"
                    />
                  </th>
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Permissions</th>
                  <th className="py-2.5 px-3">Last Modified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentPath !== '/' && (
                  <tr
                    onClick={() => {
                      setCurrentPath(parentUiPath(currentPath));
                      setSelectedFile(null);
                      setSelectedFiles([]);
                    }}
                    className="hover:bg-slate-50 cursor-pointer font-medium text-slate-600"
                  >
                    <td colSpan={5} className="py-2 px-4 flex items-center gap-2">
                      <Folder className="w-4 h-4 text-slate-400" />
                      <span>.. (up one level)</span>
                    </td>
                  </tr>
                )}
                {live === true && loading && currentFiles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Reading the directory…
                    </td>
                  </tr>
                )}
                {live === true && !loading && currentFiles.length === 0 && !error && (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center text-slate-400">
                      This directory is empty.
                    </td>
                  </tr>
                )}
                {currentFiles.map((file, idx) => {
                  const isSelected = selectedFile?.name === file.name;
                  const isChecked = selectedFiles.includes(file.name);
                  const isBeingCut = clipboard?.operation === 'cut' && clipboard.files.some(f => f.name === file.name) && clipboard.sourcePath === currentPath;

                  return (
                    <tr
                      key={`${file.name}-${idx}`}
                      onClick={() => setSelectedFile(file)}
                      onDoubleClick={() => void handleOpenFile(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedFile(file);
                        setContextMenu({ x: e.clientX, y: e.clientY, file });
                      }}
                      className={`cursor-pointer transition-colors group ${
                        isChecked
                          ? 'bg-blue-50/80 border-l-4 border-blue-500'
                          : isSelected
                          ? 'bg-blue-100/70 border-l-4 border-blue-600'
                          : 'hover:bg-slate-50/80'
                      } ${isBeingCut ? 'opacity-40 italic' : ''}`}
                    >
                      <td className="py-2.5 px-3 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleToggleSelectFile(file.name, e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer accent-blue-600"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        <div className="flex items-center gap-2.5">
                          {getFileIcon(file)}
                          <span className={`font-medium ${file.type === 'folder' ? 'text-slate-900 font-semibold' : 'text-slate-800'}`}>
                            {file.name}
                          </span>
                          {file.symlinkTarget && (
                            <span className="text-[10px] text-slate-400 font-mono" title={`Symlink → ${file.symlinkTarget}`}>
                              → {file.symlinkTarget}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{file.size}</td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{file.permissions}</td>
                      <td className="py-2.5 px-3 text-slate-400 text-[11px]">{file.modified}</td>
                    </tr>
                  );
                })}
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
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    {isSaved ? <Check className="w-3.5 h-3.5" /> : busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
                  </button>
                  <button
                    onClick={() => setEditingFile(null)}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Close Editor"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {editorNote && (
                <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-200 flex items-center gap-2">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{editorNote}</span>
                </div>
              )}

              {/* Code Editor with syntax highlighting (overlay technique) */}
              <div className="relative flex-1 overflow-hidden bg-slate-900">
                <pre
                  ref={editorPreRef}
                  aria-hidden
                  className="absolute inset-0 m-0 p-4 overflow-hidden pointer-events-none font-mono text-xs leading-relaxed whitespace-pre text-slate-100"
                  dangerouslySetInnerHTML={{ __html: `${highlightCode(editorContent, editingFile.name)}\n` }}
                />
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  onScroll={(e) => {
                    if (editorPreRef.current) {
                      editorPreRef.current.scrollTop = e.currentTarget.scrollTop;
                      editorPreRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  spellCheck={false}
                  wrap="off"
                  className="absolute inset-0 w-full h-full p-4 bg-transparent border-none outline-hidden resize-none overflow-auto font-mono text-xs leading-relaxed whitespace-pre text-transparent caret-emerald-300 focus:ring-0 selection:bg-blue-600/50"
                />
              </div>
            </div>
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center p-8 text-center text-slate-400">
              <div>
                <Edit3 className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-medium text-slate-600">Double-click a file to open the editor or preview</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Click Context Menu */}
        {contextMenu && (
          <div
            style={{ top: Math.min(contextMenu.y - 40, window.innerHeight - 280), left: Math.min(contextMenu.x - 20, window.innerWidth - 220) }}
            className="fixed z-50 w-52 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 text-xs text-slate-700 animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.file ? (
              <>
                <div className="px-3 py-1 font-mono text-[10px] text-slate-400 font-semibold border-b border-slate-100 truncate">
                  {contextMenu.file.name}
                </div>

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleOpenFile(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-500" />
                  <span>{contextMenu.file.type === 'folder' ? 'Open Folder' : 'Open / Preview'}</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleCopy([contextMenu.file]);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  <span>Copy</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleCut([contextMenu.file]);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5 text-slate-500" />
                  <span>Cut</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleDuplicate(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Duplicate</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) setRenameModal({ isOpen: true, file: contextMenu.file, newName: contextMenu.file.name });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-amber-500" />
                  <span>Rename / Move</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleDownload(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>Download</span>
                </button>

                <div className="my-1 border-t border-slate-100" />

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleDelete(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-rose-50 text-rose-600 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Delete</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setNewFileModal({ isOpen: true, name: '' });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-500" />
                  <span>New File</span>
                </button>

                <button
                  onClick={() => {
                    setNewFolderModal({ isOpen: true, name: '' });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                  <span>New Folder</span>
                </button>

                {live === true && (
                  <button
                    onClick={() => {
                      uploadInputRef.current?.click();
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Upload files here</span>
                  </button>
                )}

                {clipboard && (
                  <button
                    onClick={() => {
                      void handlePaste();
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-blue-50 text-blue-600 font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    <span>Paste ({clipboard.files.length})</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Modal: Rename File / Folder */}
        {renameModal.isOpen && renameModal.file && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">Rename File / Folder</h4>
              <form onSubmit={handleRenameSubmit} className="space-y-3">
                <input
                  type="text"
                  value={renameModal.newName}
                  onChange={(e) => setRenameModal(prev => ({ ...prev, newName: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:border-blue-500"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRenameModal({ isOpen: false, file: null, newName: '' })}
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: New File */}
        {newFileModal.isOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">New File</h4>
              <form onSubmit={handleCreateFileSubmit} className="space-y-3">
                <input
                  type="text"
                  placeholder="e.g. script.py or styles.css"
                  value={newFileModal.name}
                  onChange={(e) => setNewFileModal(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:border-blue-500"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewFileModal({ isOpen: false, name: '' })}
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    Create File
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: New Folder */}
        {newFolderModal.isOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-sm w-full p-4 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">New Folder</h4>
              <form onSubmit={handleCreateFolderSubmit} className="space-y-3">
                <input
                  type="text"
                  placeholder="e.g. assets or uploads"
                  value={newFolderModal.name}
                  onChange={(e) => setNewFolderModal(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:border-blue-500"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewFolderModal({ isOpen: false, name: '' })}
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer"
                  >
                    Create Folder
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Media & Document Preview (Image & PDF) */}
        {previewModal.isOpen && previewModal.file && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full h-[80vh] flex flex-col overflow-hidden">
              {/* Preview Bar */}
              <div className="px-5 py-3 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-mono text-xs">
                  {getFileIcon(previewModal.file)}
                  <span className="font-bold text-sm">{previewModal.file.name}</span>
                  <span className="text-[11px] text-slate-400">({previewModal.file.size})</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewModal(prev => ({ ...prev, zoom: Math.min(prev.zoom + 0.25, 2.5) }))}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPreviewModal(prev => ({ ...prev, zoom: Math.max(prev.zoom - 0.25, 0.5) }))}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPreviewModal({ isOpen: false, file: null, zoom: 1 })}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Canvas */}
              <div className="flex-1 bg-slate-100 flex items-center justify-center p-6 overflow-auto">
                {previewModal.file.previewUrl ? (
                  /* Live: the daemon serves the real bytes (cookie-authenticated) */
                  detectMediaType(previewModal.file.name) === 'image' ? (
                    <img
                      src={previewModal.file.previewUrl}
                      alt={previewModal.file.name}
                      style={{ transform: `scale(${previewModal.zoom})`, transformOrigin: 'center center' }}
                      className="max-w-full max-h-full object-contain bg-white rounded-xl shadow-lg border border-slate-200 transition-transform duration-150"
                    />
                  ) : detectMediaType(previewModal.file.name) === 'pdf' ? (
                    <iframe
                      src={previewModal.file.previewUrl}
                      title={previewModal.file.name}
                      className="w-full h-full bg-white rounded-xl shadow-lg border border-slate-200"
                    />
                  ) : detectMediaType(previewModal.file.name) === 'audio' ? (
                    <audio src={previewModal.file.previewUrl} controls className="w-full max-w-lg" />
                  ) : (
                    <video src={previewModal.file.previewUrl} controls className="max-w-full max-h-full rounded-xl shadow-lg" />
                  )
                ) : detectMediaType(previewModal.file.name) === 'image' ? (
                  <div
                    style={{ transform: `scale(${previewModal.zoom})`, transformOrigin: 'center center' }}
                    className="transition-transform duration-150 max-w-full max-h-full flex flex-col items-center justify-center p-4 bg-white rounded-xl shadow-lg border border-slate-200"
                  >
                    {previewModal.file.content ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: previewModal.file.content }}
                        className="w-96 h-60 max-w-full flex items-center justify-center"
                      />
                    ) : (
                      <div className="w-96 h-60 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-inner">
                        <span>Image Preview: {previewModal.file.name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-slate-500 text-xs">
                    <FileCheck className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p>Preview is available when the daemon is running.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {inline && <PanelSizeControl value={panelSize} onChange={setPanelSize} />}

      </div>
    </div>
  );
};

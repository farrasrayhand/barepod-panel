import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Minimize2,
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
  Lock,
  Search,
  Pause,
  Play,
  Layers,
  Info,
  Clock,
  HardDrive,
  KeyRound,
  FileArchive,
  ChevronDown,
  CornerLeftUp,
} from 'lucide-react';
import type { WebApp } from '../types';
import {
  api,
  apiReachable,
  type FileScope,
  type FileEntry as ApiFileEntry,
  uploadFileResumable,
} from '../api/client';
import { createZip } from '../utils/zip';
import { describeError } from '../utils/format';
import { highlightCode } from '../utils/highlight';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';
import 'highlight.js/styles/github.css';

interface FileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
  inline?: boolean;
  /** Which tree this browser works on: one website (default), a whole host, or a tenant home. */
  scope?: 'site' | 'host' | 'tenant';
  /** The tenant whose home is open, when scope is "tenant". */
  tenant?: string;
}

/** Everything the modal needs from the API, so one tree looks like another. */
interface FileOps {
  list(path: string): Promise<{ items: ApiFileEntry[]; readOnly: boolean; root: string }>;
  read(path: string): Promise<{ content: string; encoding: 'utf-8' | 'base64'; binary: boolean; writable: boolean }>;
  write(path: string, content: string, encoding: 'utf-8' | 'base64'): Promise<unknown>;
  create(path: string): Promise<unknown>;
  mkdir(path: string): Promise<unknown>;
  rename(path: string, name: string): Promise<unknown>;
  copy(from: string, to: string): Promise<unknown>;
  move(from: string, to: string): Promise<unknown>;
  remove(paths: string[]): Promise<unknown>;
  compress(paths: string[], destination?: string, format?: string): Promise<{ ok: boolean; path: string } | Blob>;
  extract(path: string, destination?: string, stripTopLevel?: boolean): Promise<{ ok: boolean; destination: string; extracted: string[] }>;
  extractStream?(
    path: string,
    destination: string | undefined,
    stripTopLevel: boolean,
    onProgress: (p: { current: number; total: number; file: string; percent: number }) => void,
  ): Promise<{ ok: boolean; destination: string; total: number }>;
  upload(path: string, files: File[], autoExtract?: boolean): Promise<{ uploaded: string[] }>;
  uploadChunk(form: FormData): Promise<{ uploadId: string; chunkIndex?: number; completed: boolean; path?: string; extracted?: string[] }>;
  uploadChunkStatus(uploadId: string): Promise<{ uploadId: string; chunks: number[] }>;
  downloadUrl(path: string): string;
}

/** The website family takes a slug; the host-wide family takes a scope query. */
const buildFileOps = (scope: 'site' | 'host' | 'tenant', target: string): FileOps => {
  if (scope === 'site') {
    const slug = target;
    return {
      list: async (path) => {
        const result = await api.files(slug, path);
        return { items: result.items, readOnly: false, root: '' };
      },
      read: async (path) => {
        const result = await api.readFile(slug, path);
        return { ...result, writable: true };
      },
      write: (path, content, encoding) => api.writeFile(slug, path, content, encoding),
      create: (path) => api.createFile(slug, path),
      mkdir: (path) => api.mkdir(slug, path),
      rename: (path, name) => api.renameFile(slug, path, name),
      copy: (from, to) => api.copyFiles(slug, from, to),
      move: (from, to) => api.moveFiles(slug, from, to),
      remove: (paths) => api.deleteFiles(slug, paths),
      compress: (paths, destination, format) => api.compressFiles(slug, paths, destination, format),
      extract: (path, destination, stripTopLevel) => api.extractFiles(slug, path, destination, stripTopLevel),
      extractStream: (path, destination, stripTopLevel, onProgress) =>
        api.extractFilesStream(slug, path, destination, stripTopLevel, onProgress),
      upload: (path, files, autoExtract) => api.uploadFiles(slug, path, files, autoExtract),
      uploadChunk: (form) => api.uploadChunk(slug, form),
      uploadChunkStatus: (uploadId) => api.uploadChunkStatus(slug, uploadId),
      downloadUrl: (path) => api.downloadUrl(slug, path),
    };
  }

  const fileScope: FileScope = scope === 'host' ? { kind: 'host' } : { kind: 'tenant', tenant: target };
  const scoped = api.scopedFiles;
  return {
    list: async (path) => {
      const result = await scoped.list(fileScope, path);
      return { items: result.items, readOnly: result.readOnly, root: result.root };
    },
    read: (path) => scoped.read(fileScope, path),
    write: (path, content, encoding) => scoped.write(fileScope, path, content, encoding),
    create: (path) => scoped.create(fileScope, path),
    mkdir: (path) => scoped.mkdir(fileScope, path),
    rename: (path, name) => scoped.rename(fileScope, path, name),
    copy: (from, to) => scoped.copy(fileScope, from, to),
    move: (from, to) => scoped.move(fileScope, from, to),
    remove: (paths) => scoped.remove(fileScope, paths),
    compress: (paths, destination, format) => scoped.compress(fileScope, paths, destination, format),
    extract: (path, destination, stripTopLevel) => scoped.extract(fileScope, path, destination),
    extractStream: (path, destination, stripTopLevel, onProgress) =>
      scoped.extractStream(fileScope, path, destination, stripTopLevel, onProgress),
    upload: (path, files, autoExtract) => scoped.uploadFiles(fileScope, path, files, autoExtract),
    uploadChunk: (form) => scoped.uploadChunk(fileScope, form),
    uploadChunkStatus: (uploadId) => scoped.uploadChunkStatus(fileScope, uploadId),
    downloadUrl: (path) => scoped.downloadUrl(fileScope, path),
  };
};

export interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  size: string;
  rawSize?: number;
  modified: string;
  permissions: string;
  apiPath?: string;
  previewUrl?: string;
  content?: string;
  mediaType?: 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'archive';
  symlinkTarget?: string;
  protected?: boolean;
}

interface ClipboardState {
  files: FileEntry[];
  operation: 'copy' | 'cut';
  sourcePath: string;
}

export interface UploadQueueItem {
  id: string;
  file: File;
  name: string;
  relPath: string;
  size: number;
  progress: number;
  speedBytesPerSec: number;
  status: 'queued' | 'uploading' | 'paused' | 'completed' | 'error';
  error?: string;
  extracted?: string[];
  controller?: AbortController;
}

export const isArchiveName = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.zip') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.rar') ||
    lower.endsWith('.7z')
  );
};

const detectMediaType = (fileName: string): 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'archive' => {
  if (isArchiveName(fileName)) return 'archive';
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

const toApiPath = (uiPath: string): string => uiPath.replace(/^\/+/, '').replace(/\/+$/, '');
const joinUiPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`);
const joinApiPath = (dir: string, name: string): string => {
  const parent = toApiPath(dir);
  return parent ? `${parent}/${name}` : name;
};
const parentUiPath = (uiPath: string): string => {
  const parts = uiPath.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
};

const toEntry = (item: ApiFileEntry, ops: FileOps): FileEntry => {
  const isFolder = item.type === 'directory';
  return {
    name: item.name,
    type: isFolder ? 'folder' : 'file',
    size: isFolder ? '—' : formatSize(item.size),
    rawSize: isFolder ? undefined : item.size,
    modified: formatWhen(item.modifiedAt),
    permissions: item.mode,
    apiPath: item.path,
    previewUrl: isFolder ? undefined : ops.downloadUrl(item.path),
    mediaType: isFolder ? undefined : detectMediaType(item.name),
    symlinkTarget: item.symlinkTarget,
    protected: item.protected,
  };
};

/** Helper to extract all files recursively from a folder drop */
async function getFilesFromDataTransfer(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];

  async function traverseEntry(entry: any, currentPath = ''): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      const relPath = currentPath ? `${currentPath}/${file.name}` : file.name;
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relPath,
        writable: true,
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntries = async (): Promise<any[]> => {
        return new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
      };
      let entries: any[] = [];
      let batch: any[];
      do {
        batch = await readEntries();
        entries = entries.concat(batch);
      } while (batch && batch.length > 0);

      const nextPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      for (const child of entries) {
        await traverseEntry(child, nextPath);
      }
    }
  }

  const entriesToTraverse: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.webkitGetAsEntry) {
      const entry = item.webkitGetAsEntry();
      if (entry) entriesToTraverse.push(entry);
    } else {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }

  for (const entry of entriesToTraverse) {
    await traverseEntry(entry);
  }

  return files;
}

export const FileManagerModal: React.FC<FileManagerModalProps> = ({
  isOpen,
  onClose,
  app,
  inline = false,
  scope = 'site',
  tenant = '',
}) => {
  const scopeTarget = scope === 'site' ? app?.name ?? '' : tenant;
  const ops = useMemo(() => buildFileOps(scope, scopeTarget), [scope, scopeTarget]);
  const [readOnlyRoot, setReadOnlyRoot] = useState(false);

  const [currentPath, setCurrentPath] = useState('/');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [editingFile, setEditingFile] = useState<FileEntry | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorEncoding, setEditorEncoding] = useState<'utf-8' | 'base64'>('utf-8');
  const [editorNote, setEditorNote] = useState('');
  const [editorMaximized, setEditorMaximized] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const editorPreRef = useRef<HTMLPreElement>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const folderUploadInputRef = useRef<HTMLInputElement>(null);
  const { size: panelSize, height: panelHeight, setSize: setPanelSize } = usePanelSize({ sm: 460, md: 650, lg: 850 });

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

  // Upload Queue State & Drawer
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [autoExtractOnUpload, setAutoExtractOnUpload] = useState(true);

  // Modal Dialogs
  const [renameModal, setRenameModal] = useState<{ isOpen: boolean; file: FileEntry | null; newName: string }>({
    isOpen: false,
    file: null,
    newName: '',
  });
  const [newFileModal, setNewFileModal] = useState<{ isOpen: boolean; name: string }>({
    isOpen: false,
    name: '',
  });
  const [newFolderModal, setNewFolderModal] = useState<{ isOpen: boolean; name: string }>({
    isOpen: false,
    name: '',
  });
  const [compressModal, setCompressModal] = useState<{
    isOpen: boolean;
    paths: string[];
    filename: string;
    format: 'zip' | 'tar.gz';
  }>({
    isOpen: false,
    paths: [],
    filename: '',
    format: 'zip',
  });
  const [extractModal, setExtractModal] = useState<{
    isOpen: boolean;
    file: FileEntry | null;
    destination: string;
    stripTopLevel: boolean;
    isExtracting: boolean;
    progress: {
      current: number;
      total: number;
      percent: number;
      currentFile: string;
      logs: string[];
    } | null;
  }>({
    isOpen: false,
    file: null,
    destination: '',
    stripTopLevel: true,
    isExtracting: false,
    progress: null,
  });
  const extractLogEndRef = useRef<HTMLDivElement>(null);
  const [previewModal, setPreviewModal] = useState<{ isOpen: boolean; file: FileEntry | null; zoom: number }>({
    isOpen: false,
    file: null,
    zoom: 1,
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Mock FS for Simulation fallback
  const [mockFs, setMockFs] = useState<Record<string, FileEntry[]>>({});

  useEffect(() => {
    if (!app) return;
    setMockFs({
      '/': [
        { name: '.env', type: 'file', size: '420 B', rawSize: 420, modified: 'Oct 10 16:30', permissions: '0600', mediaType: 'text', content: `APP_NAME="${app.name}"\nAPP_ENV=production\nAPP_KEY=base64:X8fJk88219PqLo01...\nAPP_DEBUG=false\nAPP_URL="https://${app.domain}"\n\nDB_CONNECTION=pgsql\nDB_HOST=127.0.0.1\nDB_PORT=5432\nDB_DATABASE=app_production\nDB_USERNAME=barepod_user\nDB_PASSWORD=secret_password\n\nREDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n` },
        { name: 'app', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:20', permissions: '0755' },
        { name: 'public', type: 'folder', size: '4.0 KB', modified: 'Oct 10 16:25', permissions: '0755' },
        { name: 'backup-site.zip', type: 'file', size: '1.2 MB', rawSize: 1258291, modified: 'Oct 11 08:30', permissions: '0644', mediaType: 'archive' },
        { name: 'composer.json', type: 'file', size: '1.8 KB', rawSize: 1840, modified: 'Oct 10 16:05', permissions: '0644', mediaType: 'text', content: `{\n  "name": "barepod/${app.name}",\n  "type": "project",\n  "require": {\n    "php": "^8.2",\n    "laravel/framework": "^11.0"\n  }\n}` },
        { name: 'package.json', type: 'file', size: '840 B', rawSize: 840, modified: 'Oct 10 16:05', permissions: '0644', mediaType: 'text', content: `{\n  "name": "${app.name}",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}` },
        { name: 'README.md', type: 'file', size: '1.2 KB', rawSize: 1200, modified: 'Oct 10 16:00', permissions: '0644', mediaType: 'text', content: `# ${app.name}\nDeployed on BarePod Panel.` },
      ],
      '/public': [
        { name: 'index.php', type: 'file', size: '1.2 KB', rawSize: 1200, modified: 'Oct 10 16:25', permissions: '0644', mediaType: 'text', content: `<?php\n\ndefine('LARAVEL_START', microtime(true));\n\nrequire __DIR__.'/../vendor/autoload.php';\n` },
        { name: '.htaccess', type: 'file', size: '520 B', rawSize: 520, modified: 'Oct 10 16:20', permissions: '0644', mediaType: 'text', content: `<IfModule mod_rewrite.c>\n    RewriteEngine On\n    RewriteCond %{REQUEST_FILENAME} !-d\n    RewriteCond %{REQUEST_FILENAME} !-f\n    RewriteRule ^ index.php [L]\n</IfModule>` },
      ],
    });
  }, [app?.name]);

  useEffect(() => {
    let cancelled = false;
    apiReachable()
      .then((ok) => { if (!cancelled) setLive(ok); })
      .catch(() => { if (!cancelled) setLive(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (live !== true) return;
    if (scope !== 'host' && !scopeTarget) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    ops
      .list(toApiPath(currentPath))
      .then((res) => {
        if (cancelled) return;
        setLiveEntries((res?.items ?? []).map((item) => toEntry(item, ops)));
        setReadOnlyRoot(res?.readOnly ?? false);
      })
      .catch((err) => { if (!cancelled) setError(describeError(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [live, scopeTarget, ops, currentPath, reloadKey]);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const rawFiles = live ? liveEntries : mockFs[currentPath] || [];
  const currentFiles = useMemo(() => {
    if (!searchFilter.trim()) return rawFiles;
    const q = searchFilter.toLowerCase();
    return rawFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [rawFiles, searchFilter]);

  // Handle open file / folder
  const handleOpenFile = async (file: FileEntry) => {
    if (file.type === 'folder') {
      setCurrentPath(joinUiPath(currentPath, file.name));
      setSelectedFile(null);
      setSelectedFiles([]);
      return;
    }

    if (isArchiveName(file.name)) {
      setExtractModal({
        isOpen: true,
        file,
        destination: currentPath,
        stripTopLevel: true,
        isExtracting: false,
        progress: null,
      });
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
      const result = await ops.read(file.apiPath ?? '');
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
      setSelectedFiles(currentFiles.map((f) => f.name));
    } else {
      setSelectedFiles([]);
    }
  };

  const handleToggleSelectFile = (fileName: string, checked: boolean) => {
    setSelectedFiles((prev) => (checked ? [...prev, fileName] : prev.filter((name) => name !== fileName)));
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
      triggerDownload(ops.downloadUrl(file.apiPath), file.name);
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
      .map((fileName) => currentFiles.find((item) => item.name === fileName))
      .filter((f): f is FileEntry => Boolean(f));

    if (live) {
      const paths = chosen.map((f) => f.apiPath ?? '').filter(Boolean);
      if (paths.length === 1) {
        handleDownload(chosen[0]);
        return;
      }
      setBusy(true);
      try {
        const blob = await ops.compress(paths);
        const url = URL.createObjectURL(blob as Blob);
        triggerDownload(url, `${app?.name ?? 'selection'}-files.zip`);
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
    const blob = createZip(
      chosen.map((f) => ({
        name: f.name,
        content: f.content ?? `// Content of ${f.name}\n// Exported from BarePod Panel\n`,
      })),
    );
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
        await ops.write(editingFile.apiPath, editorContent, editorEncoding);
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
    setMockFs((prev) => {
      const list = prev[currentPath] || [];
      return {
        ...prev,
        [currentPath]: list.map((f) => (f.name === editingFile.name ? { ...f, content: editorContent } : f)),
      };
    });
    setIsSaved(true);
    showToast(`Saved ${editingFile.name}`);
    setTimeout(() => setIsSaved(false), 1500);
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
    showToast(files.length === 1 ? `Copied to clipboard: ${files[0].name}` : `${files.length} items copied`);
  };

  const handleCut = (files: FileEntry[]) => {
    if (files.length === 0) return;
    setClipboard({ files, operation: 'cut', sourcePath: currentPath });
    showToast(files.length === 1 ? `Cut: ${files[0].name}` : `${files.length} items ready to move`);
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
            await ops.copy(file.apiPath ?? '', to);
          } else {
            await ops.move(file.apiPath ?? '', to);
          }
        }
        showToast(operation === 'copy' ? `${files.length} items pasted` : `${files.length} items moved`);
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
    const movingNames = files.map((f) => f.name);

    setMockFs((prev) => {
      const currentList = [...(prev[currentPath] || [])];
      const added: FileEntry[] = [];
      files.forEach((file) => {
        const targetName = resolveUniqueName(file.name, [...currentList, ...added].map((f) => f.name));
        added.push({ ...file, name: targetName, modified: 'Just now' });
      });

      const next: Record<string, FileEntry[]> = {
        ...prev,
        [currentPath]: [...currentList, ...added],
      };

      if (operation === 'cut') {
        if (sourcePath === currentPath) {
          next[currentPath] = next[currentPath].filter((f) => !movingNames.includes(f.name));
        } else {
          next[sourcePath] = (prev[sourcePath] || []).filter((f) => !movingNames.includes(f.name));
        }
      }

      return next;
    });

    showToast(operation === 'copy' ? `${files.length} items pasted` : `${files.length} items moved`);
    if (operation === 'cut') setClipboard(null);
  };

  const handleDelete = async (file: FileEntry) => {
    if (live) {
      setBusy(true);
      try {
        await ops.remove([file.apiPath ?? '']);
        showToast(`Deleted ${file.name}`);
        if (selectedFile?.name === file.name) setSelectedFile(null);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setMockFs((prev) => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).filter((f) => f.name !== file.name),
    }));
    if (selectedFile?.name === file.name) setSelectedFile(null);
    if (editingFile?.name === file.name) setEditingFile(null);
    setSelectedFiles((prev) => prev.filter((n) => n !== file.name));
    showToast(`Deleted ${file.name}`);
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
        await ops.remove(paths);
        setSelectedFiles([]);
        setSelectedFile(null);
        showToast(`${count} items deleted`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs((prev) => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).filter((f) => !selectedFiles.includes(f.name)),
    }));
    if (selectedFile && selectedFiles.includes(selectedFile.name)) setSelectedFile(null);
    if (editingFile && selectedFiles.includes(editingFile.name)) setEditingFile(null);
    setSelectedFiles([]);
    showToast(`${count} items deleted`);
  };

  const handleDuplicate = async (file: FileEntry) => {
    const newName = resolveUniqueName(file.name, currentFiles.map((f) => f.name));

    if (live) {
      setBusy(true);
      try {
        await ops.copy(file.apiPath ?? '', joinApiPath(currentPath, newName));
        showToast(`Duplicated as ${newName}`);
        reload();
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setMockFs((prev) => ({
      ...prev,
      [currentPath]: [...(prev[currentPath] || []), { ...file, name: newName, modified: 'Just now' }],
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
        await ops.rename(target.apiPath ?? '', newName);
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

    setMockFs((prev) => ({
      ...prev,
      [currentPath]: (prev[currentPath] || []).map((f) => (f.name === target.name ? { ...f, name: newName } : f)),
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
        await ops.create(joinApiPath(currentPath, name));
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

    setMockFs((prev) => ({
      ...prev,
      [currentPath]: [
        ...(prev[currentPath] || []),
        {
          name,
          type: 'file',
          size: '0 B',
          rawSize: 0,
          modified: 'Just now',
          permissions: '0644',
          mediaType: detectMediaType(name),
          content: '',
        },
      ],
    }));
    setNewFileModal({ isOpen: false, name: '' });
    showToast(`File ${name} created`);
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderModal.name.trim()) return;
    const name = newFolderModal.name.trim();

    if (live) {
      setBusy(true);
      try {
        await ops.mkdir(joinApiPath(currentPath, name));
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

    setMockFs((prev) => ({
      ...prev,
      [currentPath]: [
        ...(prev[currentPath] || []),
        {
          name,
          type: 'folder',
          size: '4.0 KB',
          modified: 'Just now',
          permissions: '0755',
        },
      ],
    }));
    setNewFolderModal({ isOpen: false, name: '' });
    showToast(`Folder ${name} created`);
  };

  // --- Compress and Extract Action Handlers ---
  const handleOpenCompressModal = (filesToCompress: FileEntry[]) => {
    if (filesToCompress.length === 0) return;
    const paths = filesToCompress.map((f) => f.apiPath || f.name);
    const defaultName = filesToCompress.length === 1 ? `${filesToCompress[0].name}.zip` : 'archive.zip';
    setCompressModal({
      isOpen: true,
      paths,
      filename: defaultName,
      format: 'zip',
    });
  };

  const handleCompressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (compressModal.paths.length === 0 || !compressModal.filename.trim()) return;
    setBusy(true);
    try {
      const dest = joinApiPath(currentPath, compressModal.filename.trim());
      await ops.compress(compressModal.paths, dest, compressModal.format);
      setCompressModal((prev) => ({ ...prev, isOpen: false }));
      showToast(`Created archive ${compressModal.filename}`);
      reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExtractSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extractModal.file || extractModal.isExtracting) return;
    setBusy(true);
    setExtractModal((prev) => ({
      ...prev,
      isExtracting: true,
      progress: {
        current: 0,
        total: 0,
        percent: 0,
        currentFile: 'Starting extraction...',
        logs: [`Starting decompression of ${extractModal.file?.name}...`],
      },
    }));

    try {
      const targetPath = extractModal.file.apiPath || extractModal.file.name;
      const dest = toApiPath(extractModal.destination.trim() || currentPath);

      if (ops.extractStream) {
        const res = await ops.extractStream(
          targetPath,
          dest,
          extractModal.stripTopLevel,
          (p) => {
            setExtractModal((prev) => {
              if (!prev.isOpen) return prev;
              const newLogs = [...(prev.progress?.logs || [])];
              if (newLogs.length > 80) newLogs.shift();
              newLogs.push(`[${p.current}${p.total ? '/' + p.total : ''}] ${p.file}`);
              return {
                ...prev,
                progress: {
                  current: p.current,
                  total: p.total,
                  percent: p.percent,
                  currentFile: p.file,
                  logs: newLogs,
                },
              };
            });
          },
        );
        showToast(`Extracted ${res.total || 0} items successfully`);
      } else {
        const res = await ops.extract(targetPath, dest, extractModal.stripTopLevel);
        showToast(`Extracted ${res.extracted?.length || 0} items successfully`);
      }

      setExtractModal({
        isOpen: false,
        file: null,
        destination: '',
        stripTopLevel: true,
        isExtracting: false,
        progress: null,
      });
      reload();
    } catch (err) {
      setError(describeError(err));
      setExtractModal((prev) => ({ ...prev, isExtracting: false }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (extractModal.progress) {
      extractLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [extractModal.progress?.logs.length]);

  // --- Resumable Chunked Upload Engine ---
  const enqueueUploads = (fileList: File[]) => {
    if (!fileList || fileList.length === 0) return;
    const newItems: UploadQueueItem[] = fileList.map((file) => {
      const relPath = (file as any).webkitRelativePath || (file as any).relativePath || file.name;
      return {
        id: `up_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        file,
        name: file.name,
        relPath,
        size: file.size,
        progress: 0,
        speedBytesPerSec: 0,
        status: 'queued',
      };
    });

    setUploadQueue((prev) => [...prev, ...newItems]);
    setUploadDrawerOpen(true);
  };

  // Process upload queue item by item
  useEffect(() => {
    const activeUpload = uploadQueue.find((item) => item.status === 'uploading');
    if (activeUpload) return; // already one in progress

    const nextItem = uploadQueue.find((item) => item.status === 'queued');
    if (!nextItem) return;

    let isAborted = false;
    const controller = new AbortController();

    setUploadQueue((prev) =>
      prev.map((item) => (item.id === nextItem.id ? { ...item, status: 'uploading', controller } : item)),
    );

    const runUpload = async () => {
      try {
        if (!live) {
          // Simulation upload fallback
          for (let p = 10; p <= 100; p += 25) {
            await new Promise((r) => setTimeout(r, 120));
            setUploadQueue((prev) =>
              prev.map((it) => (it.id === nextItem.id ? { ...it, progress: p, speedBytesPerSec: 1024 * 1024 * 3 } : it)),
            );
          }
          setUploadQueue((prev) =>
            prev.map((it) => (it.id === nextItem.id ? { ...it, status: 'completed', progress: 100 } : it)),
          );
          showToast(`Uploaded ${nextItem.name}`);
          return;
        }

        const res = await uploadFileResumable({
          uploadId: nextItem.id,
          file: nextItem.file,
          targetDir: toApiPath(currentPath),
          autoExtract: autoExtractOnUpload,
          uploadChunkFn: ops.uploadChunk,
          uploadStatusFn: ops.uploadChunkStatus,
          signal: controller.signal,
          onProgress: ({ percent, speedBytesPerSec }) => {
            setUploadQueue((prev) =>
              prev.map((it) => (it.id === nextItem.id ? { ...it, progress: percent, speedBytesPerSec } : it)),
            );
          },
        });

        setUploadQueue((prev) =>
          prev.map((it) =>
            it.id === nextItem.id
              ? {
                  ...it,
                  status: 'completed',
                  progress: 100,
                  extracted: res.extracted,
                }
              : it,
          ),
        );
        const extractNote = res.extracted && res.extracted.length > 0 ? ` (Auto-extracted ${res.extracted.length} files)` : '';
        showToast(`Uploaded ${nextItem.name}${extractNote}`);
        reload();
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          // upload paused or cancelled
          return;
        }
        setUploadQueue((prev) =>
          prev.map((it) =>
            it.id === nextItem.id ? { ...it, status: 'error', error: describeError(err) } : it,
          ),
        );
      }
    };

    void runUpload();
  }, [uploadQueue, live, currentPath, autoExtractOnUpload, ops]);

  const handlePauseUpload = (id: string) => {
    setUploadQueue((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          it.controller?.abort();
          return { ...it, status: 'paused', speedBytesPerSec: 0 };
        }
        return it;
      }),
    );
  };

  const handleResumeUpload = (id: string) => {
    setUploadQueue((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          return { ...it, status: 'queued', error: undefined };
        }
        return it;
      }),
    );
  };

  const handleCancelUpload = (id: string) => {
    setUploadQueue((prev) => {
      const it = prev.find((x) => x.id === id);
      it?.controller?.abort();
      return prev.filter((x) => x.id !== id);
    });
  };

  // Drag and Drop support for files and folders
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (e.dataTransfer?.items) {
      const droppedFiles = await getFilesFromDataTransfer(e.dataTransfer.items);
      if (droppedFiles.length > 0) {
        enqueueUploads(droppedFiles);
      }
    } else if (e.dataTransfer?.files) {
      enqueueUploads(Array.from(e.dataTransfer.files));
    }
  };

  const getFileIcon = (file: FileEntry) => {
    if (file.type === 'folder') {
      return <Folder className="w-4 h-4 text-amber-500 fill-amber-500/20 shrink-0" />;
    }
    if (isArchiveName(file.name)) {
      return <Archive className="w-4 h-4 text-purple-600 shrink-0" />;
    }
    const media = file.mediaType || detectMediaType(file.name);
    if (media === 'image') return <ImageIcon className="w-4 h-4 text-pink-500 shrink-0" />;
    if (media === 'pdf') return <FileCheck className="w-4 h-4 text-rose-500 shrink-0" />;
    if (
      file.name.endsWith('.php') ||
      file.name.endsWith('.py') ||
      file.name.endsWith('.js') ||
      file.name.endsWith('.ts') ||
      file.name.endsWith('.tsx') ||
      file.name.endsWith('.json') ||
      file.name.endsWith('.go')
    ) {
      return <FileCode className="w-4 h-4 text-blue-600 shrink-0" />;
    }
    if (file.name.startsWith('.env')) return <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />;
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  const breadcrumbSegments = currentPath.split('/').filter(Boolean);
  const scopeLabel =
    scope === 'host' ? 'Host root' : scope === 'tenant' ? `Tenant home — ${tenant}` : `Website — ${app?.name ?? ''}`;
  const scopePath =
    scope === 'host'
      ? '/'
      : scope === 'tenant'
        ? `/home/${tenant}`
        : app?.path || `/home/${app?.tenantUser ?? ''}/web/${app?.name ?? ''}`;
  const isLocked = (file: FileEntry | null | undefined) => Boolean(file?.protected);

  const selectedEntries = currentFiles.filter((f) => selectedFiles.includes(f.name));
  const activeFile = selectedFile || (selectedEntries.length === 1 ? selectedEntries[0] : null);

  return (
    <div
      className={
        inline
          ? 'block w-full font-sans antialiased text-slate-800'
          : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 font-sans antialiased text-slate-800'
      }
    >
      <div
        className={
          inline
            ? 'bg-white rounded-2xl border border-slate-200 shadow-xl w-full flex flex-col overflow-hidden relative'
            : 'bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-7xl w-full h-[92vh] flex flex-col overflow-hidden relative'
        }
        style={inline ? { height: panelHeight } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay visual feedback */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-50 bg-blue-600/10 backdrop-blur-xs border-2 border-dashed border-blue-500 rounded-2xl flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-150">
            <div className="p-4 rounded-2xl bg-white/95 border border-blue-200 shadow-2xl text-center space-y-2">
              <Upload className="w-10 h-10 text-blue-600 mx-auto animate-bounce" />
              <p className="text-sm font-bold text-slate-900">Drop files or folders here</p>
              <p className="text-xs text-slate-500">Preserves folder hierarchy &amp; supports instant auto-extract</p>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        {toastMessage && (
          <div className="absolute top-16 right-6 z-50 px-4 py-2.5 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-800 text-xs font-semibold flex items-center gap-2.5 animate-in fade-in slide-in-from-top-3">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Top Header */}
        <div className="px-6 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-slate-900">File Manager — {scopeLabel}</span>
                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono border border-slate-200">
                  {scopePath}
                </span>
                {live === true && (
                  <span className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live
                  </span>
                )}
                {live === false && (
                  <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-semibold">
                    Simulation
                  </span>
                )}
                {live === true && readOnlyRoot && (
                  <span className="flex items-center gap-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-semibold">
                    <Lock className="w-3 h-3" /> System paths read-only
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {live === true
                  ? scope === 'site'
                    ? 'Host files isolated in tenant environment with fast chunked uploads & extraction'
                    : 'System tree guarded from accidental deletion'
                  : 'Demonstration environment with mock data'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!inline && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="px-5 py-2.5 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Breadcrumb Path */}
          <div className="flex items-center gap-1.5 text-xs text-slate-700 font-mono overflow-x-auto py-1 max-w-full">
            <button
              onClick={() => {
                setCurrentPath('/');
                setSelectedFile(null);
                setSelectedFiles([]);
              }}
              className="px-2 py-1 rounded bg-white hover:bg-slate-100 hover:text-blue-600 font-semibold cursor-pointer border border-slate-200 shadow-xs transition-colors"
            >
              root
            </button>
            {breadcrumbSegments.map((segment, index) => {
              const target = `/${breadcrumbSegments.slice(0, index + 1).join('/')}`;
              const isLast = index === breadcrumbSegments.length - 1;
              return (
                <React.Fragment key={target}>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <button
                    onClick={() => {
                      setCurrentPath(target);
                      setSelectedFile(null);
                      setSelectedFiles([]);
                    }}
                    className={`px-2 py-1 rounded transition-colors shadow-xs ${
                      isLast
                        ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200'
                        : 'bg-white hover:bg-slate-100 hover:text-blue-600 border border-slate-200 text-slate-700'
                    }`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Search & Actions Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Real-time search filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter files..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="pl-8 pr-6 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-36 sm:w-44 transition-all shadow-xs"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <button
              onClick={reload}
              disabled={live !== true}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium cursor-pointer transition-colors shadow-xs"
              title="Refresh directory"
            >
              {loading && live === true ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
              ) : (
                <RotateCw className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Upload Files Button */}
            <button
              onClick={() => fileUploadInputRef.current?.click()}
              disabled={busy || readOnlyRoot}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer transition-colors disabled:opacity-50"
              title="Upload files (chunked & resumable)"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Files</span>
            </button>

            {/* Upload Folder Button */}
            <button
              onClick={() => folderUploadInputRef.current?.click()}
              disabled={busy || readOnlyRoot}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-xs cursor-pointer transition-colors disabled:opacity-50"
              title="Upload an entire folder hierarchy"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
              <span>Upload Folder</span>
            </button>

            {/* Extract Action (when archive is selected) */}
            {selectedFile && isArchiveName(selectedFile.name) && (
              <button
                onClick={() =>
                  setExtractModal({
                    isOpen: true,
                    file: selectedFile,
                    destination: currentPath,
                    stripTopLevel: true,
                    isExtracting: false,
                    progress: null,
                  })
                }
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-xs"
                title="Decompress / Extract archive"
              >
                <FileArchive className="w-3.5 h-3.5 text-purple-600" />
                <span>Extract</span>
              </button>
            )}

            {/* Compress Action (when 1 or more items selected) */}
            {(selectedFiles.length > 0 || selectedFile) && (
              <button
                onClick={() => handleOpenCompressModal(selectedEntries.length > 0 ? selectedEntries : selectedFile ? [selectedFile] : [])}
                disabled={busy}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-xs"
                title="Compress selected files into .zip or .tar.gz"
              >
                <Archive className="w-3.5 h-3.5 text-amber-600" />
                <span>Compress</span>
              </button>
            )}

            {/* Batch Selection Banner & Actions */}
            {selectedFiles.length > 0 && (
              <>
                <button
                  onClick={handleDownloadSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 cursor-pointer shadow-xs"
                  title="Download selection"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Download ({selectedFiles.length})</span>
                </button>

                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
                  title="Delete selection"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Delete ({selectedFiles.length})</span>
                </button>
              </>
            )}

            {/* New File & New Folder */}
            <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

            <button
              onClick={() => setNewFileModal({ isOpen: true, name: '' })}
              disabled={busy || readOnlyRoot}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              title="Create new file"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              <span>New File</span>
            </button>

            <button
              onClick={() => setNewFolderModal({ isOpen: true, name: '' })}
              disabled={busy || readOnlyRoot}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 font-medium cursor-pointer transition-colors shadow-xs disabled:opacity-50"
              title="Create new directory"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
              <span>New Folder</span>
            </button>

            {/* Paste Action */}
            {clipboard && clipboard.files.length > 0 && (
              <button
                onClick={handlePaste}
                disabled={busy || readOnlyRoot}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-xs disabled:opacity-50"
                title={`Paste ${clipboard.files.length} items`}
              >
                <Clipboard className="w-3.5 h-3.5 text-emerald-600" />
                <span>Paste ({clipboard.files.length})</span>
              </button>
            )}

            {/* Upload Queue Indicator */}
            {uploadQueue.length > 0 && (
              <button
                onClick={() => setUploadDrawerOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
              >
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>Uploads ({uploadQueue.filter((x) => x.status === 'uploading' || x.status === 'queued').length})</span>
              </button>
            )}

            {/* Toggle Inspector Sidebar */}
            <button
              onClick={() => setShowInspector((prev) => !prev)}
              className={`p-1.5 rounded-lg border text-xs cursor-pointer transition-colors shadow-xs ${
                showInspector
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-slate-200'
              }`}
              title="Toggle Details Inspector"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Hidden Upload Inputs */}
        <input
          ref={fileUploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enqueueUploads(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <input
          ref={folderUploadInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) enqueueUploads(Array.from(e.target.files));
            e.target.value = '';
          }}
        />

        {/* Main Workspace Area */}
        <div className="flex-1 flex min-h-0 bg-white overflow-hidden relative">
          {/* File Table Column */}
          <div
            className={`flex-1 flex flex-col min-w-0 bg-white overflow-y-auto select-none ${
              editingFile && !editorMaximized ? 'hidden md:flex md:w-1/2 md:border-r md:border-slate-200' : 'w-full'
            }`}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, file: null });
            }}
          >
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 sticky top-0 z-10 backdrop-blur-xs">
                <tr>
                  <th className="py-2.5 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={currentFiles.length > 0 && selectedFiles.length === currentFiles.length}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 border-slate-300 bg-white focus:ring-blue-500 cursor-pointer accent-blue-600"
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
                    className="hover:bg-blue-50/60 cursor-pointer text-slate-600 transition-colors group select-none"
                    title="Go up to parent directory"
                  >
                    <td className="py-2.5 px-3 w-10 text-center">
                      <CornerLeftUp className="w-4 h-4 text-slate-400 mx-auto group-hover:text-blue-600 group-hover:-translate-y-0.5 transition-all" />
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-800 group-hover:text-blue-600 transition-colors">..</span>
                        <span className="text-[11px] text-slate-400 font-sans font-normal">(Up one level)</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-400 font-mono">—</td>
                    <td className="py-2.5 px-3 text-xs text-slate-400 font-mono">—</td>
                    <td className="py-2.5 px-3 text-xs text-slate-400 font-mono">—</td>
                  </tr>
                )}

                {live === true && loading && currentFiles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 px-4 text-center text-slate-500">
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin inline mr-2" />
                      Loading files in {currentPath}…
                    </td>
                  </tr>
                )}

                {(!loading || currentFiles.length > 0) && currentFiles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 px-4 text-center text-slate-400 space-y-2">
                      <Folder className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="text-xs font-medium text-slate-600">This directory is empty.</p>
                      <p className="text-[11px] text-slate-400">Drag &amp; drop files or folders here to upload.</p>
                    </td>
                  </tr>
                )}

                {currentFiles.map((file, idx) => {
                  const isSelected = selectedFile?.name === file.name;
                  const isChecked = selectedFiles.includes(file.name);
                  const isBeingCut =
                    clipboard?.operation === 'cut' &&
                    clipboard.files.some((f) => f.name === file.name) &&
                    clipboard.sourcePath === currentPath;

                  return (
                    <tr
                      key={`${file.name}-${idx}`}
                      onClick={() => {
                        setSelectedFile(file);
                        setShowInspector(true);
                      }}
                      onDoubleClick={() => void handleOpenFile(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedFile(file);
                        setContextMenu({ x: e.clientX, y: e.clientY, file });
                      }}
                      className={`cursor-pointer transition-colors group ${
                        isChecked
                          ? 'bg-blue-50/80 border-l-2 border-blue-600 text-blue-900 font-medium'
                          : isSelected
                            ? 'bg-slate-100/90 border-l-2 border-blue-600 text-slate-900 font-medium'
                            : 'hover:bg-slate-50 text-slate-700'
                      } ${isBeingCut ? 'opacity-40 italic' : ''}`}
                    >
                      <td className="py-2 px-3 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleToggleSelectFile(file.name, e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 border-slate-300 bg-white focus:ring-blue-500 cursor-pointer accent-blue-600"
                        />
                      </td>
                      <td className="py-2 px-3 font-mono">
                        <div className="flex items-center gap-2.5">
                          {getFileIcon(file)}
                          <span
                            className={`truncate ${
                              file.type === 'folder'
                                ? 'text-amber-800 font-semibold'
                                : isArchiveName(file.name)
                                  ? 'text-purple-700 font-medium'
                                  : 'text-slate-800'
                            }`}
                          >
                            {file.name}
                          </span>

                          {isArchiveName(file.name) && (
                            <span className="text-[9px] bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.2 rounded font-sans font-bold">
                              ARCHIVE
                            </span>
                          )}

                          {file.symlinkTarget && (
                            <span className="text-[10px] text-slate-400 font-mono" title={`Symlink → ${file.symlinkTarget}`}>
                              → {file.symlinkTarget}
                            </span>
                          )}

                          {file.protected && (
                            <span
                              className="flex items-center gap-1 text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded"
                              title="System protected (read-only)"
                            >
                              <Lock className="w-3 h-3 text-amber-600" /> Read-only
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">{file.size}</td>
                      <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">{file.permissions}</td>
                      <td className="py-2 px-3 text-slate-500 text-[11px]">{file.modified}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Code Editor Panel */}
          {editingFile && (
            <div
              className={`flex flex-col bg-white overflow-hidden ${
                editorMaximized ? 'absolute inset-0 z-20' : 'w-full md:w-1/2 border-l border-slate-200'
              }`}
            >
              {/* Editor Bar */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 font-mono text-xs">
                  <FileCode className="w-4 h-4 text-blue-600" />
                  <span className="font-bold text-slate-900">{editingFile.name}</span>
                  <span className="text-[10px] text-slate-500">({editingFile.size})</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditorMaximized((prev) => !prev)}
                    className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
                    title={editorMaximized ? 'Restore View' : 'Maximize Editor'}
                  >
                    {editorMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={handleSaveFile}
                    disabled={busy || isLocked(editingFile)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  >
                    {isSaved ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{isSaved ? 'Saved!' : 'Save'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setEditingFile(null);
                      setEditorMaximized(false);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded cursor-pointer transition-colors"
                    title="Close Editor"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isLocked(editingFile) && (
                <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span>This is a system file: it is shown read-only, and saving is disabled.</span>
                </div>
              )}

              {editorNote && (
                <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 flex items-center gap-2">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>{editorNote}</span>
                </div>
              )}

              {/* Code Editor Area */}
              <div className="relative flex-1 overflow-hidden bg-white font-mono text-xs leading-relaxed">
                <pre
                  ref={editorPreRef}
                  aria-hidden
                  className="absolute inset-0 m-0 p-4 overflow-hidden pointer-events-none whitespace-pre text-slate-800 font-mono text-xs"
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
                  className="absolute inset-0 w-full h-full p-4 bg-transparent border-none outline-hidden resize-none overflow-auto font-mono text-xs leading-relaxed whitespace-pre text-transparent caret-blue-600 focus:ring-0 selection:bg-blue-100"
                />
              </div>
            </div>
          )}

          {/* Inspector Slide-over (When toggled on) */}
          {showInspector && !editingFile && (
            <div className="w-72 bg-slate-50/80 border-l border-slate-200 flex flex-col shrink-0 animate-in slide-in-from-right-4 duration-150">
              <div className="p-3.5 border-b border-slate-200 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-600" /> Item Details
                </span>
                <button
                  onClick={() => setShowInspector(false)}
                  className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {activeFile ? (
                <div className="p-4 space-y-4 overflow-y-auto text-xs">
                  {/* File Preview Icon / Thumbnail */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center space-y-2 shadow-xs">
                    <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                      {activeFile.type === 'folder' ? (
                        <Folder className="w-6 h-6 text-amber-500" />
                      ) : isArchiveName(activeFile.name) ? (
                        <Archive className="w-6 h-6 text-purple-600" />
                      ) : (
                        <FileText className="w-6 h-6 text-slate-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 font-mono break-all">{activeFile.name}</p>
                      <p className="text-[11px] text-slate-500 capitalize">{activeFile.type}</p>
                    </div>
                  </div>

                  {/* Metadata List */}
                  <div className="space-y-2 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Size</span>
                      <span className="font-mono text-slate-800">{activeFile.size}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Permissions</span>
                      <span className="font-mono text-slate-800">{activeFile.permissions}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span className="text-slate-500">Modified</span>
                      <span className="text-slate-700 text-[11px]">{activeFile.modified}</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">Location</span>
                      <span className="font-mono text-slate-700 truncate max-w-[120px]">{currentPath}</span>
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="space-y-2 pt-2">
                    {activeFile.type === 'file' && !isArchiveName(activeFile.name) && (
                      <button
                        onClick={() => void handleOpenFile(activeFile)}
                        className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit / View</span>
                      </button>
                    )}

                    {isArchiveName(activeFile.name) && (
                      <button
                        onClick={() =>
                          setExtractModal({
                            isOpen: true,
                            file: activeFile,
                            destination: currentPath,
                            stripTopLevel: true,
                            isExtracting: false,
                            progress: null,
                          })
                        }
                        className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                      >
                        <FileArchive className="w-3.5 h-3.5" />
                        <span>Extract Archive</span>
                      </button>
                    )}

                    <button
                      onClick={() => handleDownload(activeFile)}
                      className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600" />
                      <span>Download</span>
                    </button>

                    <button
                      onClick={() => handleOpenCompressModal([activeFile])}
                      className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                    >
                      <Archive className="w-3.5 h-3.5 text-amber-500" />
                      <span>Compress</span>
                    </button>

                    <button
                      onClick={() => setRenameModal({ isOpen: true, file: activeFile, newName: activeFile.name })}
                      disabled={isLocked(activeFile)}
                      className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 shadow-xs"
                    >
                      <span>Rename</span>
                    </button>

                    <button
                      onClick={() => void handleDelete(activeFile)}
                      disabled={isLocked(activeFile)}
                      className="w-full py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50 shadow-xs"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-slate-400 space-y-2">
                  <Info className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-xs">Select any file or folder to view its details and quick actions.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Floating Upload Queue Drawer */}
        {uploadDrawerOpen && uploadQueue.length > 0 && (
          <div className="absolute bottom-4 right-4 z-40 w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-200">
            {/* Drawer Header */}
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-900">Uploads &amp; Queue ({uploadQueue.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setUploadDrawerOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Auto Extract Checkbox */}
            <div className="px-4 py-2 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExtractOnUpload}
                  onChange={(e) => setAutoExtractOnUpload(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 border-slate-300 bg-white cursor-pointer accent-blue-600"
                />
                <span>Auto-extract archives (.zip, .tar.gz)</span>
              </label>
              {uploadQueue.some((x) => x.status === 'completed') && (
                <button
                  onClick={() => setUploadQueue((prev) => prev.filter((x) => x.status !== 'completed'))}
                  className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  Clear Done
                </button>
              )}
            </div>

            {/* Upload Tasks List */}
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
              {uploadQueue.map((item) => (
                <div key={item.id} className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-800 truncate flex-1" title={item.relPath}>
                      {item.relPath}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">{formatSize(item.size)}</span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-200 ${
                        item.status === 'completed'
                          ? 'bg-emerald-500'
                          : item.status === 'error'
                            ? 'bg-rose-500'
                            : item.status === 'paused'
                              ? 'bg-amber-500'
                              : 'bg-blue-600'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <div className="flex items-center gap-2">
                      <span
                        className={`capitalize font-semibold ${
                          item.status === 'completed'
                            ? 'text-emerald-600'
                            : item.status === 'uploading'
                              ? 'text-blue-600'
                              : item.status === 'paused'
                                ? 'text-amber-600'
                                : item.status === 'error'
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                        }`}
                      >
                        {item.status}
                      </span>
                      {item.status === 'uploading' && item.speedBytesPerSec > 0 && (
                        <span>({formatSize(item.speedBytesPerSec)}/s)</span>
                      )}
                      {item.status === 'completed' && item.extracted && item.extracted.length > 0 && (
                        <span className="text-purple-600 font-semibold">Extracted!</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {item.status === 'uploading' && (
                        <button
                          onClick={() => handlePauseUpload(item.id)}
                          className="p-1 hover:text-slate-800 cursor-pointer"
                          title="Pause"
                        >
                          <Pause className="w-3 h-3 text-amber-500" />
                        </button>
                      )}
                      {item.status === 'paused' && (
                        <button
                          onClick={() => handleResumeUpload(item.id)}
                          className="p-1 hover:text-slate-800 cursor-pointer"
                          title="Resume"
                        >
                          <Play className="w-3 h-3 text-emerald-500" />
                        </button>
                      )}
                      <button
                        onClick={() => handleCancelUpload(item.id)}
                        className="p-1 hover:text-rose-600 cursor-pointer"
                        title="Remove"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Right Click Context Menu */}
        {contextMenu && (
          <div
            style={{
              top: Math.min(contextMenu.y - 30, window.innerHeight - 300),
              left: Math.min(contextMenu.x - 20, window.innerWidth - 220),
            }}
            className="fixed z-50 w-52 bg-white rounded-xl shadow-2xl border border-slate-200 py-1.5 text-xs text-slate-700 animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.file ? (
              <>
                <div className="px-3 py-1 font-mono text-[10px] text-slate-500 font-semibold border-b border-slate-100 truncate">
                  {contextMenu.file.name}
                </div>

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleOpenFile(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 hover:text-blue-600 flex items-center gap-2 cursor-pointer font-medium"
                >
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  <span>
                    {contextMenu.file.type === 'folder'
                      ? 'Open Folder'
                      : isArchiveName(contextMenu.file.name)
                        ? 'Extract Archive…'
                        : 'Open / Preview'}
                  </span>
                </button>

                {isArchiveName(contextMenu.file.name) && (
                  <button
                    onClick={() => {
                      if (contextMenu.file) {
                        setExtractModal({
                          isOpen: true,
                          file: contextMenu.file,
                          destination: currentPath,
                          stripTopLevel: true,
                          isExtracting: false,
                          progress: null,
                        });
                      }
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-purple-50 text-purple-700 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <FileArchive className="w-3.5 h-3.5 text-purple-600" />
                    <span>Extract Archive…</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    if (contextMenu.file) handleOpenCompressModal([contextMenu.file]);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5 text-amber-500" />
                  <span>Compress…</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleCopy([contextMenu.file]);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleCut([contextMenu.file]);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Scissors className="w-3.5 h-3.5 text-slate-400" />
                  <span>Cut</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleDuplicate(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  <span>Duplicate</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) handleDownload(contextMenu.file);
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Download</span>
                </button>

                <button
                  onClick={() => {
                    if (contextMenu.file) {
                      setRenameModal({ isOpen: true, file: contextMenu.file, newName: contextMenu.file.name });
                    }
                    setContextMenu(null);
                  }}
                  disabled={isLocked(contextMenu.file)}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  <span>Rename…</span>
                </button>

                <div className="h-px bg-slate-100 my-1" />

                <button
                  onClick={() => {
                    if (contextMenu.file) void handleDelete(contextMenu.file);
                    setContextMenu(null);
                  }}
                  disabled={isLocked(contextMenu.file)}
                  className="w-full px-3 py-1.5 text-left hover:bg-rose-50 text-rose-600 hover:text-rose-700 flex items-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
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
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-600" />
                  <span>New File</span>
                </button>

                <button
                  onClick={() => {
                    setNewFolderModal({ isOpen: true, name: '' });
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                  <span>New Folder</span>
                </button>

                <button
                  onClick={() => {
                    fileUploadInputRef.current?.click();
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-600" />
                  <span>Upload Files…</span>
                </button>

                <button
                  onClick={() => {
                    folderUploadInputRef.current?.click();
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                  <span>Upload Folder…</span>
                </button>

                {clipboard && clipboard.files.length > 0 && (
                  <button
                    onClick={() => {
                      void handlePaste();
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-1.5 text-left hover:bg-emerald-50 text-emerald-700 flex items-center gap-2 cursor-pointer"
                  >
                    <Clipboard className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Paste ({clipboard.files.length} items)</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Modal: Compress */}
        {compressModal.isOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4 text-xs text-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                <Archive className="w-4 h-4 text-amber-500" />
                <span>Compress Selected Items</span>
              </div>

              <form onSubmit={handleCompressSubmit} className="space-y-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Archive Filename</label>
                  <input
                    type="text"
                    value={compressModal.filename}
                    onChange={(e) => setCompressModal((prev) => ({ ...prev, filename: e.target.value }))}
                    placeholder="e.g. backup.zip"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-xs"
                    autoFocus
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Format</label>
                  <select
                    value={compressModal.format}
                    onChange={(e) =>
                      setCompressModal((prev) => ({
                        ...prev,
                        format: e.target.value as 'zip' | 'tar.gz',
                        filename: prev.filename.replace(/\.(zip|tar\.gz|tar)$/, '') + (e.target.value === 'zip' ? '.zip' : '.tar.gz'),
                      }))
                    }
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-hidden focus:border-blue-500 shadow-xs"
                  >
                    <option value="zip">.zip (Standard ZIP Archive)</option>
                    <option value="tar.gz">.tar.gz (Gzip compressed tarball)</option>
                  </select>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
                  <p className="font-semibold text-slate-700">Items to compress ({compressModal.paths.length}):</p>
                  <p className="font-mono text-slate-600 truncate">{compressModal.paths.join(', ')}</p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setCompressModal((prev) => ({ ...prev, isOpen: false }))}
                    className="px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Compress Now</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Extract */}
        {extractModal.isOpen && extractModal.file && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-5 space-y-4 text-xs text-slate-800">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <FileArchive className="w-4 h-4 text-purple-600" />
                  <span>Extract Archive</span>
                </div>
                {extractModal.isExtracting && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full font-mono text-[10px] font-semibold animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Extracting...
                  </span>
                )}
              </div>

              <form onSubmit={handleExtractSubmit} className="space-y-4">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] space-y-1">
                  <p className="text-slate-500">Archive File:</p>
                  <p className="font-mono text-slate-900 font-bold">{extractModal.file.name}</p>
                </div>

                {!extractModal.isExtracting ? (
                  <>
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">Destination Directory</label>
                      <input
                        type="text"
                        value={extractModal.destination}
                        onChange={(e) => setExtractModal((prev) => ({ ...prev, destination: e.target.value }))}
                        placeholder="e.g. / or /extracted-folder"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-xs"
                        autoFocus
                        required
                      />
                      <p className="text-[10px] text-slate-500 mt-1">Leave as current directory or specify a target subfolder.</p>
                    </div>

                    <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-slate-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={extractModal.stripTopLevel}
                        onChange={(e) => setExtractModal((prev) => ({ ...prev, stripTopLevel: e.target.checked }))}
                        className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                      />
                      <div className="space-y-0.5 text-[11px]">
                        <span className="font-semibold text-slate-800">Flatten single outer folder</span>
                        <p className="text-slate-500 text-[10px] leading-relaxed">
                          If the archive wraps everything inside a single directory (e.g. <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700">supri/...</code>), unwrap its contents directly into this destination instead of creating an extra nested folder.
                        </p>
                      </div>
                    </label>
                  </>
                ) : (
                  <div className="space-y-3 p-3.5 bg-slate-900 text-slate-200 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-purple-300">Extraction Progress</span>
                      <span className="font-mono text-xs text-slate-300 font-bold">
                        {extractModal.progress?.percent || 0}%
                      </span>
                    </div>

                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-150 rounded-full"
                        style={{ width: `${Math.max(2, extractModal.progress?.percent || 0)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                      <span>Files extracted: {extractModal.progress?.current || 0} {extractModal.progress?.total ? `/ ${extractModal.progress.total}` : ''}</span>
                    </div>

                    <div className="mt-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 font-mono text-[10px] text-slate-300 max-h-36 overflow-y-auto space-y-1 shadow-inner select-text">
                      {extractModal.progress?.logs.map((log, i) => (
                        <div key={i} className="truncate text-slate-300">
                          {log}
                        </div>
                      ))}
                      <div ref={extractLogEndRef} />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={extractModal.isExtracting}
                    onClick={() =>
                      setExtractModal({
                        isOpen: false,
                        file: null,
                        destination: '',
                        stripTopLevel: true,
                        isExtracting: false,
                        progress: null,
                      })
                    }
                    className="px-3.5 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                  >
                    {extractModal.isExtracting ? 'Extracting...' : 'Cancel'}
                  </button>
                  {!extractModal.isExtracting && (
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                    >
                      <FileArchive className="w-3.5 h-3.5" />
                      <span>Extract Here</span>
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: New File */}
        {newFileModal.isOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-4 space-y-3 text-xs text-slate-800">
              <h4 className="font-bold text-slate-900 text-sm">Create New File</h4>
              <form onSubmit={handleCreateFileSubmit} className="space-y-3">
                <input
                  type="text"
                  placeholder="e.g. index.html or config.json"
                  value={newFileModal.name}
                  onChange={(e) => setNewFileModal((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-xs"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewFileModal({ isOpen: false, name: '' })}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition-colors shadow-xs"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: New Folder */}
        {newFolderModal.isOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-4 space-y-3 text-xs text-slate-800">
              <h4 className="font-bold text-slate-900 text-sm">Create New Folder</h4>
              <form onSubmit={handleCreateFolderSubmit} className="space-y-3">
                <input
                  type="text"
                  placeholder="e.g. assets or public"
                  value={newFolderModal.name}
                  onChange={(e) => setNewFolderModal((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-xs"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setNewFolderModal({ isOpen: false, name: '' })}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition-colors shadow-xs"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Rename */}
        {renameModal.isOpen && renameModal.file && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full p-4 space-y-3 text-xs text-slate-800">
              <h4 className="font-bold text-slate-900 text-sm">Rename Item</h4>
              <form onSubmit={handleRenameSubmit} className="space-y-3">
                <input
                  type="text"
                  value={renameModal.newName}
                  onChange={(e) => setRenameModal((prev) => ({ ...prev, newName: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono text-xs focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-xs"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRenameModal({ isOpen: false, file: null, newName: '' })}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg cursor-pointer transition-colors shadow-xs"
                  >
                    Rename
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Media & Document Preview (Image & PDF) */}
        {previewModal.isOpen && previewModal.file && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-4xl w-full h-[85vh] flex flex-col overflow-hidden text-slate-800">
              {/* Preview Bar */}
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5 font-mono text-xs">
                  {getFileIcon(previewModal.file)}
                  <span className="font-bold text-sm text-slate-900">{previewModal.file.name}</span>
                  <span className="text-[11px] text-slate-500">({previewModal.file.size})</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewModal((prev) => ({ ...prev, zoom: Math.min(prev.zoom + 0.25, 2.5) }))}
                    className="p-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-xs cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPreviewModal((prev) => ({ ...prev, zoom: Math.max(prev.zoom - 0.25, 0.5) }))}
                    className="p-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-xs cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPreviewModal({ isOpen: false, file: null, zoom: 1 })}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Canvas */}
              <div className="flex-1 bg-slate-100 flex items-center justify-center p-6 overflow-auto">
                {previewModal.file.previewUrl ? (
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
                    <video
                      src={previewModal.file.previewUrl}
                      controls
                      className="max-w-full max-h-full rounded-xl shadow-lg"
                    />
                  )
                ) : (
                  <div className="text-center text-slate-500 space-y-2">
                    <FileCheck className="w-10 h-10 mx-auto text-slate-400" />
                    <p className="text-xs">Preview is available when running in live mode.</p>
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

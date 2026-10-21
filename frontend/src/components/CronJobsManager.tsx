import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Terminal,
  RotateCw,
  Search,
  Sparkles,
  Server,
  Globe,
  X,
  Check,
  Copy
} from 'lucide-react';
import { api, type ApiCronJob, type SystemCronJob, type ApiWebsite } from '../api/client';

interface CronJobsManagerProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  defaultWebsiteSlug?: string;
}

export const CronJobsManager: React.FC<CronJobsManagerProps> = ({
  onShowToast,
  defaultWebsiteSlug,
}) => {
  const [loading, setLoading] = useState(true);
  const [systemJobs, setSystemJobs] = useState<SystemCronJob[]>([]);
  const [websiteJobs, setWebsiteJobs] = useState<ApiCronJob[]>([]);
  const [websites, setWebsites] = useState<ApiWebsite[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'website' | 'system'>('all');
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>(defaultWebsiteSlug || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  // Form State
  const [formSite, setFormSite] = useState('');
  const [formName, setFormName] = useState('');
  const [formSchedule, setFormSchedule] = useState('* * * * *');
  const [formCommand, setFormCommand] = useState('');
  const [formTimeout, setFormTimeout] = useState(300);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Run Now State & Output Drawer
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  // Built-in maintenance jobs: which one is running, and which schedule is being edited.
  const [runningSystemJobId, setRunningSystemJobId] = useState<string | null>(null);
  const [editingSystemId, setEditingSystemId] = useState<string | null>(null);
  const [systemScheduleDraft, setSystemScheduleDraft] = useState('');
  const [outputModal, setOutputModal] = useState<{
    isOpen: boolean;
    jobName: string;
    status: string;
    output: string;
    durationMs?: number;
    runAt?: string;
  } | null>(null);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cronRes, sitesRes] = await Promise.all([
        api.cronJobs(),
        api.websites(),
      ]);
      setSystemJobs(cronRes.systemJobs || []);
      setWebsiteJobs(cronRes.websiteJobs || []);
      setWebsites(sitesRes.items || []);
      if (sitesRes.items?.length > 0) {
        // Functional update: reading `formSite` here would make loadData change on every edit and
        // the effect would refetch the whole list while the operator types.
        setFormSite((current) => current || defaultWebsiteSlug || sitesRes.items[0].slug);
      }
    } catch (err) {
      onShowToast?.('Failed to load cron jobs', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setLoading(false);
    }
  }, [defaultWebsiteSlug, onShowToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setEditingJobId(null);
    setFormSite(selectedSiteFilter !== 'all' ? selectedSiteFilter : (websites[0]?.slug || ''));
    setFormName('');
    setFormSchedule('* * * * *');
    setFormCommand('');
    setFormTimeout(300);
    setIsModalOpen(true);
  };

  const handleApplyPreset = (preset: 'laravel' | 'wordpress' | 'django' | 'node' | 'clean') => {
    if (preset === 'laravel') {
      setFormName('Laravel Task Scheduler');
      setFormSchedule('* * * * *');
      setFormCommand('php artisan schedule:run');
    } else if (preset === 'wordpress') {
      setFormName('WordPress WP-Cron Runner');
      setFormSchedule('*/10 * * * *');
      setFormCommand('php wp-cron.php');
    } else if (preset === 'django') {
      setFormName('Django Management Task');
      setFormSchedule('0 3 * * *');
      setFormCommand('python manage.py clearsessions');
    } else if (preset === 'node') {
      setFormName('Node Routine Worker');
      setFormSchedule('0 * * * *');
      setFormCommand('npm run cron:hourly');
    } else if (preset === 'clean') {
      setFormName('Log & Temp Prune');
      setFormSchedule('0 4 * * *');
      setFormCommand('find storage/logs -type f -mtime +7 -delete');
    }
  };

  const handleApplySchedulePreset = (schedule: string) => {
    setFormSchedule(schedule);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSite || !formName || !formSchedule || !formCommand) {
      onShowToast?.('Incomplete form', 'Please fill out all required fields', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      if (modalMode === 'create') {
        const created = await api.createCronJob({
          websiteSlug: formSite,
          name: formName,
          schedule: formSchedule,
          command: formCommand,
          enabled: true,
          timeoutSec: formTimeout,
        });
        setWebsiteJobs((prev) => [...prev, created]);
        onShowToast?.('Cron Job Created', `Scheduled task '${formName}' is now active.`, 'success');
      } else if (editingJobId) {
        const updated = await api.updateCronJob(editingJobId, {
          name: formName,
          schedule: formSchedule,
          command: formCommand,
          timeoutSec: formTimeout,
        });
        setWebsiteJobs((prev) => prev.map((j) => (j.id === editingJobId ? updated : j)));
        onShowToast?.('Cron Job Updated', `Scheduled task '${formName}' updated.`, 'success');
      }
      setIsModalOpen(false);
    } catch (err) {
      onShowToast?.('Failed to save cron job', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleEnable = async (job: ApiCronJob) => {
    try {
      const updated = await api.updateCronJob(job.id, { enabled: !job.enabled });
      setWebsiteJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      onShowToast?.(
        job.enabled ? 'Cron Job Paused' : 'Cron Job Activated',
        `'${job.name}' is now ${!job.enabled ? 'active' : 'paused'}.`,
        'info'
      );
    } catch (err) {
      onShowToast?.('Failed to toggle cron job', err instanceof Error ? err.message : 'Unknown error', 'error');
    }
  };

  const handleDelete = async (job: ApiCronJob) => {
    if (!confirm(`Are you sure you want to delete scheduled task '${job.name}'?`)) return;
    try {
      await api.deleteCronJob(job.id);
      setWebsiteJobs((prev) => prev.filter((j) => j.id !== job.id));
      onShowToast?.('Cron Job Deleted', `'${job.name}' has been deleted.`, 'success');
    } catch (err) {
      onShowToast?.('Failed to delete cron job', err instanceof Error ? err.message : 'Unknown error', 'error');
    }
  };

  const handleRunNow = async (job: ApiCronJob) => {
    setRunningJobId(job.id);
    try {
      const res = await api.runCronJob(job.id);
      setWebsiteJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, lastRunAt: res.runAt, lastStatus: res.status, lastOutput: res.output } : j))
      );
      setOutputModal({
        isOpen: true,
        jobName: job.name,
        status: res.status,
        output: res.output || '(No output returned)',
        durationMs: res.durationMs,
        runAt: res.runAt,
      });
      onShowToast?.(
        res.ok ? 'Execution Succeeded' : 'Execution Failed',
        `Task completed with status: ${res.status} (${res.durationMs}ms)`,
        res.ok ? 'success' : 'error'
      );
    } catch (err) {
      onShowToast?.('Failed to run cron job', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setRunningJobId(null);
    }
  };

  const handleViewLastOutput = (job: ApiCronJob) => {
    setOutputModal({
      isOpen: true,
      jobName: job.name,
      status: job.lastStatus || 'never',
      output: job.lastOutput || '(No previous execution log)',
      runAt: job.lastRunAt,
    });
  };

  const handleToggleSystem = async (job: SystemCronJob) => {
    try {
      const updated = await api.updateSystemCronJob(job.id, { enabled: !job.enabled });
      setSystemJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      onShowToast?.(
        updated.enabled ? 'Job enabled' : 'Job disabled',
        `'${job.label}' is now ${updated.enabled ? 'active' : 'paused'}.`,
        'info'
      );
    } catch (err) {
      onShowToast?.('Could not change the job', err instanceof Error ? err.message : 'Unknown error', 'error');
    }
  };

  const handleSaveSystemSchedule = async (job: SystemCronJob) => {
    try {
      const updated = await api.updateSystemCronJob(job.id, { schedule: systemScheduleDraft.trim() });
      setSystemJobs((prev) => prev.map((j) => (j.id === job.id ? updated : j)));
      setEditingSystemId(null);
      onShowToast?.('Schedule saved', `'${job.label}' now runs on ${updated.schedule}.`, 'success');
    } catch (err) {
      onShowToast?.('Invalid schedule', err instanceof Error ? err.message : 'Unknown error', 'error');
    }
  };

  const handleRunSystemNow = async (job: SystemCronJob) => {
    setRunningSystemJobId(job.id);
    try {
      const res = await api.runSystemCronJob(job.id);
      setSystemJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, lastRunAt: res.runAt, lastStatus: res.status, lastOutput: res.output } : j))
      );
      setOutputModal({
        isOpen: true,
        jobName: job.label,
        status: res.status,
        output: res.output || '(No output returned)',
        durationMs: res.durationMs,
        runAt: res.runAt,
      });
      onShowToast?.(
        res.ok ? 'Job succeeded' : 'Job failed',
        `${job.label} finished with status: ${res.status} (${res.durationMs}ms)`,
        res.ok ? 'success' : 'error'
      );
    } catch (err) {
      onShowToast?.('Could not run the job', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setRunningSystemJobId(null);
    }
  };

  // Filter Logic
  const filteredWebsitesJobs = websiteJobs.filter((job) => {
    if (selectedSiteFilter !== 'all' && job.websiteSlug !== selectedSiteFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        job.name.toLowerCase().includes(q) ||
        job.command.toLowerCase().includes(q) ||
        job.websiteSlug.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredSystemJobs = systemJobs.filter((job) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return job.label.toLowerCase().includes(q) || job.desc.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl shadow-sm border border-slate-700/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-400/20">
              <Clock className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-white tracking-tight">Cron & Scheduled Tasks</h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
              Host Scheduler
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-xl leading-relaxed">
            Automate routine maintenance, Laravel <code className="text-blue-300 font-mono">schedule:run</code>, WordPress wp-cron, and queue cleanup under kernel tenant UID isolation.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600/60 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Refresh Tasks"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Scheduled Task</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-2xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              filterType === 'all'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Tasks ({websiteJobs.length + systemJobs.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('website')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              filterType === 'website'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Globe className="w-3 h-3" />
            <span>Website Tasks ({websiteJobs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilterType('system')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              filterType === 'system'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Server className="w-3 h-3" />
            <span>System Maintenance ({systemJobs.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {filterType !== 'system' && websites.length > 0 && (
            <select
              value={selectedSiteFilter}
              onChange={(e) => setSelectedSiteFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700 outline-hidden focus:border-blue-500"
            >
              <option value="all">All Websites</option>
              {websites.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.slug} ({w.domain})
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 outline-hidden focus:border-blue-500 focus:bg-white w-40 sm:w-48"
            />
          </div>
        </div>
      </div>

      {/* Website Scheduled Tasks Section */}
      {(filterType === 'all' || filterType === 'website') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-600" />
              <span>Website Application Scheduled Tasks</span>
              <span className="text-[11px] font-semibold text-slate-500">
                ({filteredWebsitesJobs.length} active)
              </span>
            </h3>
            <span className="text-xs text-slate-500">Runs inside /home/{'{tenant}'}/web/{'{slug}'}</span>
          </div>

          {filteredWebsitesJobs.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-2xl space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">No scheduled website tasks yet</p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-0.5">
                  Configure automated commands like <code className="bg-slate-200/80 px-1 py-0.5 rounded text-slate-700">php artisan schedule:run</code> to keep background workers alive.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Task</span>
              </button>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
              <div className="divide-y divide-slate-100">
                {filteredWebsitesJobs.map((job) => {
                  const isRunning = runningJobId === job.id;
                  return (
                    <div
                      key={job.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900">{job.name}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                            {job.websiteSlug}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-slate-500" />
                            <span>{job.schedule}</span>
                          </span>
                          {job.enabled ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.2 rounded">
                              Active
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.2 rounded">
                              Paused
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs font-mono text-slate-700">
                          <Terminal className="w-3 h-3 text-slate-400 shrink-0" />
                          <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] font-mono text-slate-800 truncate max-w-lg">
                            {job.command}
                          </code>
                        </div>

                        {job.lastRunAt && (
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span>Last run: {new Date(job.lastRunAt).toLocaleString()}</span>
                            <span>•</span>
                            <span
                              className={`flex items-center gap-1 font-semibold ${
                                job.lastStatus === 'success' ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {job.lastStatus === 'success' ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              <span>{job.lastStatus}</span>
                            </span>
                            {job.lastOutput && (
                              <button
                                type="button"
                                onClick={() => handleViewLastOutput(job)}
                                className="text-blue-600 hover:underline cursor-pointer ml-1"
                              >
                                View Log
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleRunNow(job)}
                          disabled={isRunning}
                          className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors shadow-2xs"
                          title="Execute Command Immediately"
                        >
                          <Play className={`w-3 h-3 text-emerald-700 fill-emerald-700 ${isRunning ? 'animate-pulse' : ''}`} />
                          <span>{isRunning ? 'Running...' : 'Run Now'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleEnable(job)}
                          className={`px-2.5 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-2xs ${
                            job.enabled
                              ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                              : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700'
                          }`}
                        >
                          {job.enabled ? 'Pause' : 'Activate'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDelete(job)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete Scheduled Task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* System Maintenance Cron Section */}
      {(filterType === 'all' || filterType === 'system') && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-600" />
              <span>System & Server Level Maintenance Cron</span>
              <span className="text-[11px] font-semibold text-slate-500">
                ({filteredSystemJobs.length} automated jobs)
              </span>
            </h3>
            <span className="text-xs text-slate-500">Run by the daemon on their own schedule</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
            <div className="divide-y divide-slate-100">
              {filteredSystemJobs.map((job) => {
                const isRunning = runningSystemJobId === job.id;
                const isEditing = editingSystemId === job.id;
                return (
                  <div
                    key={job.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">{job.label}</span>
                        {isEditing ? (
                          <input
                            value={systemScheduleDraft}
                            onChange={(e) => setSystemScheduleDraft(e.target.value)}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-blue-300 w-44"
                          />
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                            {job.schedule}
                          </span>
                        )}
                        <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {job.category}
                        </span>
                        {!job.implemented && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.2 rounded">
                            Not implemented
                          </span>
                        )}
                        {job.implemented && !job.enabled && (
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.2 rounded">
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{job.desc}</p>
                      {job.lastRunAt && (
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span>Last run: {new Date(job.lastRunAt).toLocaleString()}</span>
                          <span>•</span>
                          <span
                            className={`font-semibold ${
                              job.lastStatus === 'success' ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {job.lastStatus}
                          </span>
                          {job.lastOutput && (
                            <button
                              type="button"
                              onClick={() =>
                                setOutputModal({
                                  isOpen: true,
                                  jobName: job.label,
                                  status: job.lastStatus || 'never',
                                  output: job.lastOutput || '',
                                  runAt: job.lastRunAt,
                                })
                              }
                              className="text-blue-600 hover:underline cursor-pointer"
                            >
                              View Log
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleSaveSystemSchedule(job)}
                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSystemId(null)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRunSystemNow(job)}
                            disabled={isRunning || !job.implemented}
                            title={job.implemented ? 'Execute now' : 'Not implemented by this daemon yet'}
                            className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Play className={`w-3 h-3 text-emerald-700 fill-emerald-700 ${isRunning ? 'animate-pulse' : ''}`} />
                            <span>{isRunning ? 'Running...' : 'Run Now'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSystemId(job.id);
                              setSystemScheduleDraft(job.schedule);
                            }}
                            className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                          >
                            Schedule
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleSystem(job)}
                            className={`px-2.5 py-1.5 border rounded-lg text-xs font-semibold cursor-pointer shadow-2xs ${
                              job.enabled
                                ? 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                                : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700'
                            }`}
                          >
                            {job.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-xl w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {modalMode === 'create' ? 'Create Scheduled Task' : 'Edit Scheduled Task'}
                  </h3>
                  <p className="text-xs text-slate-500">Executes inside website directory as tenant user</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Presets Helper */}
              <div className="p-3 bg-blue-50/70 border border-blue-200/60 rounded-xl space-y-1.5">
                <span className="text-[11px] font-bold text-blue-900 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span>Quick Presets:</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('laravel')}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-white hover:bg-blue-100/60 border border-blue-200 rounded text-blue-800 cursor-pointer"
                  >
                    Laravel schedule:run
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('wordpress')}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-white hover:bg-blue-100/60 border border-blue-200 rounded text-blue-800 cursor-pointer"
                  >
                    WordPress wp-cron
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('django')}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-white hover:bg-blue-100/60 border border-blue-200 rounded text-blue-800 cursor-pointer"
                  >
                    Django Sessions
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('node')}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-white hover:bg-blue-100/60 border border-blue-200 rounded text-blue-800 cursor-pointer"
                  >
                    Node Worker
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset('clean')}
                    className="px-2 py-0.5 text-[11px] font-semibold bg-white hover:bg-blue-100/60 border border-blue-200 rounded text-blue-800 cursor-pointer"
                  >
                    Prune Logs
                  </button>
                </div>
              </div>

              {/* Target Website */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Website *</label>
                <select
                  value={formSite}
                  onChange={(e) => setFormSite(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden"
                >
                  {websites.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.slug} ({w.domain}) — Tenant: {w.tenantUser}
                    </option>
                  ))}
                </select>
              </div>

              {/* Job Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Task Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Laravel Scheduler or Queue Worker"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden"
                />
              </div>

              {/* Cron Schedule */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">Cron Schedule Expression *</label>
                  <span className="text-[10px] text-slate-500">minute hour day month weekday</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formSchedule}
                    onChange={(e) => setFormSchedule(e.target.value)}
                    placeholder="* * * * *"
                    required
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:bg-white focus:border-blue-500 outline-hidden"
                  />
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
                  <span className="font-semibold">Common:</span>
                  <button
                    type="button"
                    onClick={() => handleApplySchedulePreset('* * * * *')}
                    className="hover:underline text-blue-600"
                  >
                    Every min (* * * * *)
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleApplySchedulePreset('*/5 * * * *')}
                    className="hover:underline text-blue-600"
                  >
                    Every 5m (*/5 * * * *)
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleApplySchedulePreset('0 * * * *')}
                    className="hover:underline text-blue-600"
                  >
                    Hourly (0 * * * *)
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => handleApplySchedulePreset('0 0 * * *')}
                    className="hover:underline text-blue-600"
                  >
                    Daily Midnight (0 0 * * *)
                  </button>
                </div>
              </div>

              {/* Command */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Command *</label>
                <div className="relative">
                  <Terminal className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                  <textarea
                    rows={3}
                    placeholder="e.g. php artisan schedule:run >> /dev/null 2>&1"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-900 border border-slate-800 rounded-lg text-emerald-400 focus:border-blue-500 outline-hidden resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Execution Timeout (seconds)</label>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={formTimeout}
                  onChange={(e) => setFormTimeout(parseInt(e.target.value) || 300)}
                  className="w-32 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 outline-hidden"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-md shadow-blue-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : modalMode === 'create' ? 'Create Scheduled Task' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Output / Log Modal */}
      {outputModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden text-white animate-in zoom-in-95 duration-200">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">Execution Output: {outputModal.jobName}</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.2 rounded border ${
                    outputModal.status === 'success'
                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                      : 'bg-rose-950/80 text-rose-400 border-rose-800'
                  }`}
                >
                  {outputModal.status}
                </span>
                {outputModal.durationMs !== undefined && (
                  <span className="text-[10px] font-mono text-slate-400">({outputModal.durationMs}ms)</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(outputModal.output);
                    setCopiedOutput(true);
                    setTimeout(() => setCopiedOutput(false), 1500);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                  title="Copy output"
                >
                  {copiedOutput ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => setOutputModal(null)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {outputModal.output}
            </div>

            <div className="px-5 py-2.5 border-t border-slate-800/80 bg-slate-900/40 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Timestamp: {outputModal.runAt || 'Just now'}</span>
              <button
                type="button"
                onClick={() => setOutputModal(null)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

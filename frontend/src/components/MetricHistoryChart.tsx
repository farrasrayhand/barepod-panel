import React from 'react';

interface MetricHistoryChartProps {
  title: string;
  unit?: string;
  data: number[];
  color: string;
  height?: number;
}

export const MetricHistoryChart: React.FC<MetricHistoryChartProps> = ({
  title,
  unit = '',
  data,
  color,
  height = 120,
}) => {
  const width = 400;
  const pad = 6;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1);

  const points = data.map((value, i) => [
    pad + i * stepX,
    height - pad - ((value - min) / span) * (height - pad * 2),
  ] as const);

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  const firstX = points[0]?.[0] ?? pad;
  const lastX = points[points.length - 1]?.[0] ?? width - pad;
  const area = `${line} L${lastX.toFixed(1)} ${height - pad} L${firstX.toFixed(1)} ${height - pad} Z`;

  const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
  const gradientId = `hist-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/40">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-1.5">
        <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">{title}</span>
        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
          min {min.toFixed(1)}{unit} · avg {avg.toFixed(1)}{unit} · max {max.toFixed(1)}{unit}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
};

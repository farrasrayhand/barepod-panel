import React, { useRef, useState } from 'react';

interface MetricHistoryChartProps {
  title: string;
  unit?: string;
  data: number[];
  color: string;
  height?: number;
  ticks?: string[];
  gradientId?: string;
}

export const MetricHistoryChart: React.FC<MetricHistoryChartProps> = ({
  title,
  unit = '',
  data,
  color,
  height = 170,
  ticks,
  gradientId,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 420;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 22;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const dataMax = Math.max(...data, 1);
  const yMax = dataMax * 1.15;
  const stepX = plotW / Math.max(1, data.length - 1);

  const toX = (i: number) => padL + i * stepX;
  const toY = (v: number) => padT + plotH - (v / yMax) * plotH;

  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
  const area = `${line} L${toX(data.length - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L${padL.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const avg = data.reduce((a, b) => a + b, 0) / Math.max(1, data.length);
  const gid = gradientId ?? `hist-${title.replace(/\W+/g, '-').toLowerCase()}`;

  const yTicks = [yMax, yMax / 2, 0];
  const xTicks = ticks && ticks.length === 3 ? ticks : ['', '', ''];
  const hovered = hoverIdx === null ? null : data[hoverIdx];
  const hoverX = hoverIdx === null ? 0 : toX(hoverIdx);
  const hoverY = hovered === null ? 0 : toY(hovered);
  const tooltipRight = hoverX > width - 110;
  const tickLabel = hoverIdx === null ? '' : xTicks[hoverIdx < data.length / 3 ? 0 : hoverIdx < (data.length * 2) / 3 ? 1 : 2];

  const handleMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round((x - padL) / stepX);
    setHoverIdx(Math.min(data.length - 1, Math.max(0, idx)));
  };

  return (
    <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-1.5">
        <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">{title}</span>
        <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">
          avg {avg.toFixed(1)}{unit} · max {dataMax.toFixed(1)}{unit}
        </span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full select-none"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* y gridlines + labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={toY(v)} x2={width - padR} y2={toY(v)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={i === 2 ? '' : '3 4'} />
            <text x={padL - 5} y={toY(v) + 3} textAnchor="end" fontSize="8.5" fill="#94a3b8" fontFamily="system-ui, sans-serif">
              {v >= 10 ? v.toFixed(0) : v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* x axis labels */}
        {xTicks.map((label, i) => (
          <text
            key={label + i}
            x={padL + (plotW / 2) * i}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            fontSize="8.5"
            fill="#94a3b8"
            fontFamily="system-ui, sans-serif"
          >
            {label}
          </text>
        ))}

        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* hover crosshair + marker */}
        {hoverIdx !== null && hovered !== null && (
          <g pointerEvents="none">
            <line x1={hoverX} y1={padT} x2={hoverX} y2={padT + plotH} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={hoverX} cy={hoverY} r="4.5" fill="#fff" stroke={color} strokeWidth="2" />
            <g transform={`translate(${tooltipRight ? hoverX - 92 : hoverX + 8}, ${Math.max(padT, hoverY - 26)})`}>
              <rect width="86" height="20" rx="5" fill="#0f172a" opacity="0.92" />
              <text x="7" y="13.5" fontSize="9.5" fill="#f8fafc" fontFamily="ui-monospace, monospace" fontWeight="bold">
                {hovered.toFixed(1)}{unit}
              </text>
              <text x="79" y="13.5" fontSize="8.5" fill="#94a3b8" textAnchor="end" fontFamily="system-ui, sans-serif">
                {tickLabel}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
};

import React from 'react';
import type { PanelSize } from '../hooks/usePanelSize';

interface PanelSizeControlProps {
  value: PanelSize;
  onChange: (size: PanelSize) => void;
  dark?: boolean;
}

const OPTIONS: Array<{ id: PanelSize; label: string; title: string }> = [
  { id: 'sm', label: 'S', title: 'Compact height' },
  { id: 'md', label: 'M', title: 'Default height' },
  { id: 'lg', label: 'L', title: 'Tall height' },
];

export const PanelSizeControl: React.FC<PanelSizeControlProps> = ({ value, onChange, dark = false }) => (
  <div
    className={`flex items-center justify-center gap-1 h-7 shrink-0 border-t ${
      dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
    }`}
  >
    <span className={`text-[10px] font-semibold mr-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Height</span>
    {OPTIONS.map((option) => (
      <button
        key={option.id}
        type="button"
        title={option.title}
        onClick={() => onChange(option.id)}
        className={`w-6 h-5 rounded text-[10px] font-bold transition-colors ${
          value === option.id
            ? 'bg-blue-600 text-white'
            : dark
              ? 'bg-slate-800 text-slate-400 hover:text-slate-200'
              : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

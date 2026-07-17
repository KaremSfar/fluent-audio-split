import type { ParamDef } from '@/lib/advancedParams';
import { Tooltip } from '@/components/workflow/Tooltip';

interface ParamRowProps {
  def: ParamDef;
  value: unknown;
  onChange: (val: unknown) => void;
}

export function ParamRow({ def, value, onChange }: ParamRowProps) {
  const inputClass =
    'flex h-7 rounded-md border border-input bg-transparent px-2 py-0.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  let control: React.ReactNode;

  if (def.type === 'boolean') {
    const checked = Boolean(value ?? def.default);
    control = (
      <button
        onClick={() => onChange(!checked)}
        title={checked ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
          checked ? 'bg-violet-500' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    );
  } else if (def.type === 'select') {
    control = (
      <select
        value={String(value ?? def.default)}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} flex-1`}
      >
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  } else if (def.type === 'number') {
    control = (
      <input
        type="number"
        value={Number(value ?? def.default)}
        min={def.min}
        max={def.max}
        step={def.step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${inputClass} w-24 text-right`}
      />
    );
  } else {
    // text (e.g. demucs_segment_size which can be "Default")
    control = (
      <input
        type="text"
        value={String(value ?? def.default)}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} w-24`}
      />
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center text-xs text-foreground/80 flex-1 min-w-0">
        {def.label}
        <Tooltip text={def.description} />
      </span>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

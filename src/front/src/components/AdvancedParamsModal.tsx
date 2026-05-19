import { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  getParamGroupsForArch,
  type ModelArch,
  type ParamDef,
} from '@/lib/advancedParams';

// ── Tooltip — portal-based to escape overflow-hidden/auto containers ──────────
function Tooltip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top - 6, left: r.left + r.width / 2 });
    }
  }, []);

  const hide = useCallback(() => setPos(null), []);

  return (
    <span
      ref={ref}
      className="inline-flex items-center ml-1 cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <span className="text-[10px] leading-none text-muted-foreground/50 hover:text-muted-foreground select-none">ⓘ</span>
      {pos && createPortal(
        <span
          className="pointer-events-none fixed z-[99999] w-60 rounded-md bg-popover border border-border text-popover-foreground text-[11px] leading-snug p-2 shadow-lg whitespace-normal"
          style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}

// ── Single param row ──────────────────────────────────────────────────────────
function ParamRow({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
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

// ── Main modal ────────────────────────────────────────────────────────────────
interface AdvancedParamsModalProps {
  arch: ModelArch;
  modelLabel: string;
  params: Record<string, unknown>;
  onChange: (key: string, val: unknown) => void;
  onReset: () => void;
  onClose: () => void;
}

export function AdvancedParamsModal({
  arch,
  modelLabel,
  params,
  onChange,
  onReset,
  onClose,
}: AdvancedParamsModalProps) {
  const groups = getParamGroupsForArch(arch);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-background border border-border rounded-xl shadow-2xl w-[440px] max-h-[78vh] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-none">Advanced Parameters</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{modelLabel}</p>
          </div>
          <div className="flex items-center gap-3 ml-3 shrink-0">
            <button
              onClick={onReset}
              className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Reset defaults
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground text-sm leading-none"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 pb-1 border-b border-border/50">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.params.map((def) => (
                  <ParamRow
                    key={def.key}
                    def={def}
                    value={params[def.key]}
                    onChange={(val) => onChange(def.key, val)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="flex h-7 items-center rounded-md bg-violet-500 px-3 text-xs font-medium text-white hover:bg-violet-600 focus:outline-none"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

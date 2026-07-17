import { createPortal } from 'react-dom';
import { getParamGroupsForArch, type ModelArch } from '@/lib/advancedParams';
import { ParamRow } from '@/components/workflow/ParamRow';

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

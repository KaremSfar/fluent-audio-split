import { useEffect, useId, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/theme/useTheme';
import { THEME_PREFERENCES, type ThemePreference } from '@/theme/theme';

const LABELS: Record<ThemePreference, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const ICONS: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** Header theme switch: sun/moon button opening a Light / Dark / System menu (arrow keys, Esc). */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, theme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const current = THEME_PREFERENCES.indexOf(preference);
    itemRefs.current[current]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // Focus the checked item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (n: number) => items[(n + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focusAt(i + 1);
        break;
      case 'ArrowUp':
        focusAt(i - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const Icon = theme === 'dark' ? Moon : Sun;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Theme: ${LABELS[preference]}${preference === 'system' ? ` (${theme})` : ''}. Change theme`}
        title="Theme"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {THEME_PREFERENCES.map((pref, i) => {
            const ItemIcon = ICONS[pref];
            const checked = pref === preference;
            return (
              <button
                key={pref}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => {
                  setPreference(pref);
                  close(true);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <ItemIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 text-left">{LABELS[pref]}</span>
                {checked && <Check className="size-4" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

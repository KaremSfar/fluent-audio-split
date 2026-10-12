/**
 * Shared class strings for the Results DAW controls. Everything is built on theme tokens
 * (`daw-*`, `primary`, `foreground`, …) so the studio follows light/dark with one codepath.
 */
const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-daw-surface';

/** Base control: 32 px tall, consistent radius/type. */
export const ctl = `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors ${focus} disabled:pointer-events-none disabled:opacity-50`;
/** Square 32 px icon control. */
export const ctlIcon = `${ctl} w-8 px-0`;
/** Neutral (off) fill. */
export const neutral = 'bg-daw-control text-foreground hover:bg-daw-control-hover';
/** Quiet (ghost) fill. */
export const ghost = 'bg-transparent text-muted-foreground hover:bg-daw-control hover:text-foreground';
/** Pressed / on. */
export const on = 'bg-primary text-primary-foreground hover:bg-primary/90';
/** Toggle fill for aria-pressed buttons. */
export const toggle = (pressed: boolean) => (pressed ? on : neutral);

/** Inputs and selects. */
export const field = `h-8 rounded-md border border-daw-border bg-daw-lane px-2 text-xs text-foreground ${focus}`;

/** Segmented control: track + items. */
export const segTrack = 'inline-flex shrink-0 items-center gap-0.5 rounded-md bg-daw-control p-0.5';
export const segItem = (pressed: boolean) =>
  `inline-flex h-7 items-center whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium transition-colors ${focus} disabled:pointer-events-none disabled:opacity-50 ${
    pressed ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
  }`;

/** Small muted caption used before a control. */
export const caption = 'text-xs text-muted-foreground';

export { focus as dawFocus };

/**
 * Small pieces the parts views share: buttons, pills, section labels, the
 * search field, thumbnails, the account avatar. Everything is drawn with the
 * theme's tokens (Tailwind utilities from the viewer's tailwind-theme.css),
 * so the views follow VS Code's theme, high contrast included, or
 * Protoboard's own.
 */
import { forwardRef, useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, cx } from "@deltarobotics/uhd-viewer/components";
import { knownMatte, readMatte, type Matte } from "./matte.js";

/** The body face: the theme's in a webview (VS Code's, or Kode Mono under a Protoboard colour theme), a neutral sans elsewhere. */
export const BODY = "font-[family-name:var(--pb-font-body)]";

export type Tone = "neutral" | "ok" | "info" | "warning" | "error" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-muted",
  ok: "text-ok",
  info: "text-info",
  warning: "text-warning",
  error: "text-error",
  accent: "text-accent",
};

const TONE_DOT: Record<Tone, string> = { neutral: "bg-fg-muted", ok: "bg-ok", info: "bg-info", warning: "bg-warning", error: "bg-error", accent: "bg-accent" };

/** A small outlined pill: `used v2`, `update v3`, `v2 · recommended`; `icon` puts a symbol before the words. */
export function Pill({ tone = "neutral", children, title, solid, icon }: { tone?: Tone; children: ReactNode; title?: string; solid?: boolean; icon?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none whitespace-nowrap",
        solid ? "border-transparent text-on-accent" : "border-current bg-transparent",
        solid && tone === "ok" && "bg-ok",
        solid && tone === "info" && "bg-info",
        solid && tone === "accent" && "bg-accent",
        solid && tone === "warning" && "bg-warning",
        solid && tone === "neutral" && "bg-muted text-fg",
        !solid && TONE_TEXT[tone],
        "outline-1 -outline-offset-1 outline-contrast",
      )}
    >
      {icon && <Icon name={icon} size={11} strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}

/** A mono tag: `I2C`, `QFN-32`. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-[18px] shrink-0 items-center rounded-[3px] bg-muted px-1.5 font-ui text-[10.5px] leading-none text-fg-muted outline-1 -outline-offset-1 outline-contrast">{children}</span>;
}

/** Groups the user folded away, by id: kept by the host when it gives `closed` and `onClosed`, else for as long as the view is open. */
export interface FoldedGroups {
  /** The groups folded away when the view opens (the host's saved state). */
  closed?: readonly string[];
  /** Every change, for the host to keep. */
  onClosed?(ids: string[]): void;
}

/**
 * Which groups are folded away (PB-1039, as in the alpha): one toggles; all
 * fold or open together.
 */
export function useFolded({ closed: given, onClosed }: FoldedGroups = {}): { closed: ReadonlySet<string>; toggle(id: string): void; setAll(ids: readonly string[]): void } {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(given ?? []));
  const set = useCallback(
    (next: ReadonlySet<string>) => {
      setClosed(next);
      onClosed?.([...next]);
    },
    [onClosed],
  );
  const toggle = useCallback((id: string) => set(closed.has(id) ? new Set([...closed].filter((x) => x !== id)) : new Set([...closed, id])), [closed, set]);
  const setAll = useCallback((ids: readonly string[]) => set(new Set(ids)), [set]);
  return { closed, toggle, setAll };
}

/** A group's heading that folds it away and opens it again: a chevron, the title, and what is on its right (a count). */
export function FoldHeading({ open, onToggle, children, right, className, titleClassName }: { open: boolean; onToggle: () => void; children: ReactNode; right?: ReactNode; className?: string; titleClassName?: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cx(
        "flex w-full cursor-pointer items-center gap-1.5 rounded-[4px] text-left hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        className,
      )}
    >
      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <span className={cx("min-w-0 flex-1 truncate font-ui tracking-[0.12em] uppercase", titleClassName ?? "text-[10.5px] text-fg-muted")}>{children}</span>
      {right}
    </button>
  );
}

/** A section heading in the label face: CATEGORIES, ACCOUNT. */
export function SectionLabel({ icon, children, right }: { icon?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-6 items-center gap-1.5 text-fg-muted">
      {icon && <Icon name={icon} size={13} strokeWidth={1.75} aria-hidden />}
      <span className="font-ui text-[10.5px] tracking-[0.14em] uppercase">{children}</span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

type ButtonKind = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  kind?: ButtonKind;
  size?: "sm" | "md";
}

/** A text button (content actions; toolbars use icon buttons). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ icon, kind = "secondary", size = "md", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        BODY,
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[4px] border whitespace-nowrap transition-colors",
        size === "sm" ? "h-6 px-2 text-[12px]" : "h-8 px-3 text-[13px]",
        kind === "primary" && "border-transparent bg-accent font-medium text-on-accent hover:bg-accent-hover",
        kind === "secondary" && "border-[var(--pb-control-border)] bg-transparent text-fg hover:bg-hover",
        kind === "ghost" && "border-transparent bg-transparent text-fg-muted hover:bg-hover hover:text-fg",
        "outline-1 -outline-offset-1 outline-contrast hover:outline-dashed hover:outline-contrast-active",
        "focus-visible:outline focus-visible:outline-focus focus-visible:outline-solid",
        "disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent",
        kind === "primary" && "disabled:hover:bg-accent",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 13 : 15} strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
});

/** A small square icon action inside a card or row, naming itself in a tooltip. */
export function RowAction({ icon, label, onClick, tone, disabled }: { icon: string; label: string; onClick: () => void; tone?: Tone; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] border border-transparent transition-colors",
        tone ? TONE_TEXT[tone] : "text-fg-muted",
        "hover:bg-active hover:text-fg hover:outline hover:outline-1 hover:outline-dashed hover:-outline-offset-1 hover:outline-contrast-active",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus",
        "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      <Icon name={icon} size={15} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/** The search field: a VS Code input in a webview, the theme's sunken field elsewhere. Debounced. */
export function SearchField({ value, placeholder, onChange, className, autoFocus }: { value: string; placeholder: string; onChange: (v: string) => void; className?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <label
      className={cx(
        BODY,
        "flex h-8 min-w-0 items-center gap-2 rounded-[4px] border border-line bg-sunken px-2.5 text-fg-muted",
        "focus-within:border-focus focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-focus",
        className,
      )}
    >
      <Icon name="search" size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <input
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChange(text);
          if (e.key === "Escape" && text) setText("");
        }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-fg outline-none placeholder:text-fg-faint"
      />
      {text && (
        <button type="button" aria-label="Clear the search" data-tooltip="Clear" onClick={() => (setText(""), onChange(""))} className="grid size-5 cursor-pointer place-items-center rounded-[3px] text-fg-muted hover:bg-hover hover:text-fg">
          <Icon name="x" size={13} aria-hidden />
        </button>
      )}
    </label>
  );
}

/** A part's picture on its matte (product photos and renders are shot on white), or the part's icon. */
export function Thumb({ src, alt, className, iconSize = 28, icon = "cpu" }: { src?: string; alt: string; className?: string; iconSize?: number; /** The placeholder when there is no picture. */ icon?: string }) {
  const [failed, setFailed] = useState(false);
  // first ask for pixels the page may read (CORS); a picture that refuses is shown without
  const [cors, setCors] = useState(true);
  const [matte, setMatte] = useState<Matte | undefined>(() => knownMatte(src));
  useEffect(() => {
    setFailed(false);
    setCors(true);
    setMatte(knownMatte(src));
  }, [src]);
  const shown = src && !failed;
  return (
    <div
      data-matte={shown ? (matte ?? "pending") : "none"}
      className={cx(
        "pb-thumb relative grid place-items-center overflow-hidden bg-[var(--pb-thumb-clear)]",
        "data-[matte=photo]:bg-[var(--pb-thumb-tile)] data-[matte=white]:bg-[var(--pb-thumb-tile)] [&[data-matte=white]>img]:[mix-blend-mode:var(--pb-thumb-blend)]",
        className,
      )}
    >
      {shown ? (
        // absolutely placed: a percentage height inside a grid cell does not resolve, so a plain img overflows its box and is cropped
        <img
          key={cors ? "cors" : "plain"}
          src={src}
          alt={alt}
          draggable={false}
          crossOrigin={cors ? "anonymous" : undefined}
          onLoad={(e) => setMatte(readMatte(e.currentTarget) ?? "white")}
          onError={() => (cors ? setCors(false) : setFailed(true))}
          className="absolute inset-0 box-border size-full object-contain p-[5%]"
        />
      ) : (
        <Icon name={icon} size={iconSize} strokeWidth={1.25} className="text-[var(--pb-thumb-fg)]" aria-hidden />
      )}
    </div>
  );
}

/** The signed-in person's initial, in the accent. */
export function Avatar({ email, size = 28 }: { email?: string; size?: number }) {
  const letter = (email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.46 }} className="grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-on-accent outline-1 -outline-offset-1 outline-contrast">
      {email ? letter : <Icon name="user" size={size * 0.55} />}
    </span>
  );
}

/** A floating card: the surface, a hairline border, the theme's shadow (none in high contrast). */
export function Card({ children, className, as: As = "div", ...rest }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" } & Record<string, unknown>) {
  return (
    <As className={cx("rounded-[6px] border border-line bg-[var(--pb-card)] outline-1 -outline-offset-1 outline-contrast", className)} {...rest}>
      {children}
    </As>
  );
}

/** A status with its dot: Priced, Unpriced, Needs quote. */
export function StatusText({ tone, children, plain }: { tone: Tone; children: ReactNode; /** Only the dot takes the tone. */ plain?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap", plain ? "text-fg" : TONE_TEXT[tone])}>
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", plain ? TONE_DOT[tone] : "bg-current")} />
      {children}
    </span>
  );
}

/** A Lucide icon for a category, by its name or path. */
export function categoryIcon(pathOrName: string): string {
  const s = pathOrName.toLowerCase();
  const table: [RegExp, string][] = [
    [/micro|mcu|controller|processor/, "cpu"],
    [/sensor/, "radar"],
    [/humid/, "droplets"],
    [/environment|temperature/, "thermometer"],
    [/motion|imu|accel|gyro/, "move-3d"],
    [/distance|tof|range|proximity/, "ruler"],
    [/light|optical|led|display/, "sun"],
    [/pressure|baro/, "gauge"],
    [/gnss|gps|position/, "navigation"],
    [/encoder/, "scan"],
    [/actuator|motor|servo/, "cog"],
    [/power|battery|regulator|charger|converter/, "battery-charging"],
    [/connector|cable|harness/, "plug"],
    [/connectivity|wireless|radio|wifi|bluetooth|network/, "wifi"],
    [/expansion|board|shield|breakout|module/, "circuit-board"],
    [/mechanical|structure|frame|bracket|fastener|hardware/, "wrench"],
    [/robot/, "bot"],
    [/passive|resistor|capacitor|inductor|component/, "component"],
    [/gas/, "wind"],
  ];
  // the most specific segment first ("sensor.environmental.gas" is a gas sensor before it is a sensor)
  const segments = s.split(/[./›>]+/).filter(Boolean).reverse();
  for (const segment of [...segments, s]) {
    const hit = table.find(([re]) => re.test(segment));
    if (hit) return hit[1];
  }
  return "box";
}

/** A Lucide icon for a fact, by its label. */
export function factIcon(label: string): string {
  const s = label.toLowerCase();
  const table: [RegExp, string][] = [
    [/temperature/, "thermometer"],
    [/supply|voltage|vin|vcc|power/, "zap"],
    [/pressure/, "gauge"],
    [/humid/, "droplets"],
    [/gas/, "wind"],
    [/interface|bus|protocol/, "network"],
    [/size|board|dimension/, "ruler"],
    [/mass|weight/, "weight"],
    [/current/, "activity"],
    [/package/, "package"],
    [/pin/, "pin"],
    [/mount/, "anchor"],
    [/version/, "git-commit-horizontal"],
  ];
  return table.find(([re]) => re.test(s))?.[1] ?? "info";
}

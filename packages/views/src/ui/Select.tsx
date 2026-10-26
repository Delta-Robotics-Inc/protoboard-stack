/**
 * A themed dropdown (Radix Select) for the views: the trigger and the list
 * draw with the theme's tokens (surface, line, text, focus, the contrast
 * outline in high contrast), and the list portals into the themed root, so it
 * follows VS Code's theme like everything else. Keyboard and screen readers
 * get Radix's listbox. A native <select> draws its list with the operating
 * system's colours, whatever the theme.
 */
import * as RadixSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";
import { Icon, cx, useTheme } from "@deltarobotics/uhd-viewer/components";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** What the trigger shows when this option is picked (defaults to the label). */
  text?: string;
}

export interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange(value: string): void;
  /** The accessible name. */
  label: string;
  /** A tooltip on the trigger. */
  tooltip?: string;
  className?: string;
  /** Draw the trigger yourself (its content; `className` then styles the whole trigger). */
  trigger?: ReactNode;
}

export function Select({ value, options, onChange, label, tooltip, className, trigger }: SelectProps) {
  const { root } = useTheme();
  const picked = options.find((o) => o.value === value);
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        aria-label={label}
        data-tooltip={tooltip}
        className={
          trigger
            ? cx("cursor-pointer outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus", className)
            : cx(
                "inline-flex h-8 max-w-[420px] min-w-0 cursor-pointer items-center gap-2 rounded-md border border-line bg-sunken px-2 font-ui text-[12px] text-fg outline-1 -outline-offset-1 outline-contrast",
                "hover:border-line-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus data-[state=open]:border-line-strong",
                className,
              )
        }
      >
        {trigger ?? (
          <>
            <span className="min-w-0 truncate">
              <RadixSelect.Value>{picked?.text ?? picked?.label}</RadixSelect.Value>
            </span>
            <RadixSelect.Icon asChild>
              <Icon name="chevron-down" size={13} className="shrink-0 text-fg-muted" aria-hidden />
            </RadixSelect.Icon>
          </>
        )}
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={root ?? undefined}>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          align="start"
          collisionPadding={8}
          className="z-[1000] flex max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface text-fg flex-col shadow-panel outline outline-1 -outline-offset-1 outline-contrast"
        >
          {/* the list scrolls without a scrollbar (Radix hides it), with arrows at the ends when it overflows */}
          <RadixSelect.ScrollUpButton className="flex h-5 cursor-default items-center justify-center text-fg-muted">
            <Icon name="chevron-up" size={13} aria-hidden />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className={cx(
                  "relative flex h-7 cursor-pointer items-center gap-2 rounded-[4px] pr-2 pl-7 font-ui text-[12px] whitespace-nowrap text-fg outline-none select-none",
                  "data-[highlighted]:bg-hover data-[highlighted]:outline data-[highlighted]:outline-1 data-[highlighted]:-outline-offset-1 data-[highlighted]:outline-contrast-active",
                  "data-[state=checked]:font-semibold",
                )}
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex">
                  <Icon name="check" size={13} className="text-accent" aria-hidden />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-5 cursor-default items-center justify-center text-fg-muted">
            <Icon name="chevron-down" size={13} aria-hidden />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

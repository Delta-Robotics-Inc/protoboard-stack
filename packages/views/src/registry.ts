/**
 * The view registry: views keyed by id, each saying which modules it applies
 * to. The shells' view tabs for the focused module come from it, in order.
 * Built-in views register at start-up; extensions' views come from their
 * manifests (`contributes.views`), with or without a component yet.
 */
import type { ComponentType } from "react";
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import type { ResolvedView } from "@protoboardai/core";
import { isViewId } from "@protoboardai/core/views";
import { appliesFromDecl } from "./applies.js";
import type { ViewDefinition, ViewProps } from "./types.js";

export class ViewRegistry {
  private views = new Map<string, ViewDefinition>();
  private listeners = new Set<() => void>();

  /**
   * Adds a view. An id already registered is refused, unless `replace` is
   * given (an extension's working view taking over a planned one).
   * Returns a function that removes it again.
   */
  register(view: ViewDefinition, options: { replace?: boolean } = {}): () => void {
    if (!isViewId(view.id)) throw new Error(`view id "${view.id}" must be lowercase words with dashes, optionally "<extension>.<view>"`);
    const had = this.views.get(view.id);
    if (had && !options.replace) throw new Error(`view ${view.id} is already registered (by ${had.source ?? "builtin"})`);
    const entry: ViewDefinition = { status: view.component ? "ready" : "planned", ...view };
    this.views.set(view.id, entry);
    this.changed();
    return () => {
      if (this.views.get(view.id) !== entry) return;
      if (had) this.views.set(view.id, had);
      else this.views.delete(view.id);
      this.changed();
    };
  }

  get(id: string): ViewDefinition | undefined {
    return this.views.get(id);
  }

  /** Every view, in tab order. */
  list(): ViewDefinition[] {
    return [...this.views.values()].sort(byOrder);
  }

  /** The views that apply to a module, in tab order (a view whose predicate throws is left out). */
  forModule(module: ModuleDef, bundle: UhdBundle, path = ""): ViewDefinition[] {
    return this.list().filter((v) => {
      try {
        return v.applies(module, bundle, { path });
      } catch {
        return false;
      }
    });
  }

  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of [...this.listeners]) l();
  }
}

const byOrder = (a: ViewDefinition, b: ViewDefinition) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id);

/**
 * Registers the views extensions declare (core's resolveViews). A declared
 * view with a component in `components` (by view id) is ready; one without is
 * planned. A declared id the registry already has replaces it only when the
 * declaration brings a component and the registered one is planned; otherwise
 * the declaration is skipped and reported in the result.
 */
export function registerContributedViews(
  registry: ViewRegistry,
  views: readonly ResolvedView[],
  components: Readonly<Record<string, ComponentType<ViewProps>>> = {},
): { registered: string[]; skipped: { id: string; reason: string }[] } {
  const registered: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const v of views) {
    const component = components[v.id];
    const existing = registry.get(v.id);
    if (existing && !(component && existing.status === "planned")) {
      skipped.push({ id: v.id, reason: existing.status === "planned" ? `${v.extension} declares ${v.id} without a component; the built-in placeholder stays` : `${v.id} is already a working view (${existing.source ?? "builtin"})` });
      continue;
    }
    registry.register(
      {
        id: v.id,
        title: v.title,
        icon: v.icon,
        order: v.order,
        applies: appliesFromDecl(v.appliesTo),
        component,
        source: v.extension,
      },
      { replace: Boolean(existing) },
    );
    registered.push(v.id);
  }
  return { registered, skipped };
}

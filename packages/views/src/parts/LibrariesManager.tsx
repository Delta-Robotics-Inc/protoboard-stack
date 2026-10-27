/**
 * Manage libraries, as a settings page in its own tab (PB-902, design 03):
 * the account the libraries use, the libraries in search order (the first
 * that has an id wins unless a part is pinned to one) with their address,
 * size and access, and adding one by URL. Tokens are never stored: a
 * library that needs one names an environment variable, or uses the
 * Protoboard sign-in.
 */
import { useState } from "react";
import { Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import type { AccountModel, LibrariesActions, LibrariesModel, ManagedLibraryModel } from "./model.js";
import { PartsSurface } from "./Surface.js";
import { Avatar, BODY, Button, Card, Pill, RowAction, StatusText, type Tone } from "./ui.js";
import { Select } from "../ui/Select.js";

const ACCESS: Record<ManagedLibraryModel["access"], { tone: Tone; label: (l: ManagedLibraryModel) => string }> = {
  "signed-in": { tone: "ok", label: () => "Signed in" },
  token: { tone: "ok", label: (l) => `Token from ${l.authEnv}` },
  "token-missing": { tone: "warning", label: (l) => `${l.authEnv} is not set` },
  public: { tone: "neutral", label: () => "Public" },
  "sign-in": { tone: "warning", label: () => "Needs a sign-in" },
  error: { tone: "error", label: (l) => l.error ?? "Not reachable" },
  checking: { tone: "neutral", label: () => "Checking…" },
};

/** A service URL as its host ("cloud.protoboard.ai"), or the text as given. */
const hostOf = (service: string | undefined): string | undefined => {
  if (!service) return undefined;
  try {
    return new URL(service).host || service;
  } catch {
    return service;
  }
};

/** The account the libraries use: who, and the sign-in action. */
export function AccountCard({ account, actions }: { account: AccountModel; actions: Pick<LibrariesActions, "signIn" | "signOut" | "manageAccount"> }) {
  const signedIn = account.state === "signed-in";
  const title =
    account.state === "signed-in"
      ? `Signed in as ${account.email ?? "you"}`
      : account.state === "expired"
        ? "Sign in again"
        : account.state === "open"
          ? "No account needed"
          : account.state === "signed-out"
            ? "Not signed in"
            : account.detail
              ? "Sign-in not checked"
              : "Checking the sign-in…";
  const note =
    account.state === "signed-in"
      ? (account.detail ?? hostOf(account.service) ?? "")
      : account.state === "expired"
        ? `The sign-in${account.email ? ` as ${account.email}` : ""} no longer works${account.problem ? `: ${account.problem}` : ""}`
        : account.state === "open"
          ? `${hostOf(account.service) ?? "This library"} needs no sign-in`
          : account.state === "signed-out"
            ? "Needed for library parts and prices"
            : (account.detail ?? "");
  return (
    <Card className={cx(BODY, "flex items-center gap-3 px-4 py-3")}>
      <Avatar email={signedIn ? account.email : undefined} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-fg">{title}</p>
        <p className="truncate text-[12px] text-fg-muted">{note}</p>
      </div>
      {signedIn && actions.manageAccount && (
        <Button size="sm" icon="external-link" onClick={actions.manageAccount}>
          Manage Account
        </Button>
      )}
      {signedIn && actions.signOut && (
        <Button size="sm" onClick={actions.signOut}>
          Sign out
        </Button>
      )}
      {(account.state === "signed-out" || account.state === "expired" || account.state === "unknown") && actions.signIn && (
        <Button size="sm" kind="primary" icon="log-in" onClick={actions.signIn}>
          Sign in
        </Button>
      )}
    </Card>
  );
}

const GRID = "grid grid-cols-[20px_minmax(150px,1.3fr)_minmax(160px,2.2fr)_64px_minmax(130px,1.4fr)_76px] items-center gap-3 max-[820px]:grid-cols-[20px_minmax(0,1fr)_76px]";

/** A row being dragged by its handle: which library, and where it would land. */
interface Drag {
  key: string;
  over?: string;
}

const rowKey = (l: ManagedLibraryModel) => `${l.scope}:${l.id}`;

function LibraryRow({ lib, first, last, actions, working, alone, drag, setDrag, onDrop }: { lib: ManagedLibraryModel; first: boolean; last: boolean; actions: LibrariesActions; working: boolean; alone: boolean; drag?: Drag; setDrag: (d: Drag | undefined) => void; onDrop: (from: string, to: string) => void }) {
  const a = ACCESS[lib.access];
  const key = rowKey(lib);
  const dragged = drag?.key === key;
  // a library moves within its own scope (the project's order, or your personal list); the default library stays put
  const movable = lib.scope !== "default" && !working && !alone;
  const target = !!drag && !dragged && drag.key.split(":")[0] === lib.scope;
  return (
    <div
      onDragOver={(e) => {
        if (!target) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (drag?.over !== key) setDrag({ key: drag!.key, over: key });
      }}
      onDragLeave={() => drag?.over === key && setDrag({ key: drag.key })}
      onDrop={(e) => {
        if (!target) return;
        e.preventDefault();
        onDrop(drag!.key, key);
      }}
      className={cx(GRID, BODY, "min-h-11 border-t border-line-subtle px-3 py-1.5 text-[13px]", dragged && "opacity-50", drag?.over === key && "bg-accent-tint outline outline-1 -outline-offset-1 outline-focus")}
    >
      <span
        draggable={movable}
        role="img"
        aria-label={movable ? "Drag to reorder" : undefined}
        data-tooltip={movable ? "Drag to change the search order" : undefined}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", key);
          setDrag({ key });
        }}
        onDragEnd={() => setDrag(undefined)}
        className={cx("grid h-6 place-items-center rounded-[3px]", movable ? "cursor-grab text-fg-muted hover:bg-hover active:cursor-grabbing" : "text-fg-faint opacity-40")}
      >
        <Icon name="grip-vertical" size={14} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col max-[820px]:gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="library-big" size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate text-fg" title={lib.id}>
            {lib.name ?? lib.id}
          </span>
          <Pill>{lib.scope}</Pill>
        </span>
        <span className="hidden truncate font-ui text-[11.5px] text-fg-muted max-[820px]:block">{lib.url}</span>
        <span className="hidden max-[820px]:block">
          <StatusText tone={a.tone} plain>{a.label(lib)}</StatusText>
        </span>
      </div>
      <span className="truncate font-ui text-[12px] text-fg max-[820px]:hidden" title={lib.url}>
        {lib.url}
      </span>
      <span className="font-ui text-[12px] text-fg max-[820px]:hidden">{lib.parts !== undefined ? lib.parts.toLocaleString("en-US") : "—"}</span>
      <span className="min-w-0 truncate max-[820px]:hidden" title={lib.error}>
        <StatusText tone={a.tone} plain>{a.label(lib)}</StatusText>
      </span>
      <span className="flex justify-end">
        <RowAction icon="arrow-up" label="Search it earlier" disabled={first || working} onClick={() => actions.move(lib.id, lib.scope, "up")} />
        <RowAction icon="arrow-down" label="Search it later" disabled={last || working} onClick={() => actions.move(lib.id, lib.scope, "down")} />
        <RowAction icon="trash" label={lib.scope === "default" ? "The default library stays unless the project lists others" : lib.pinned ? `Remove (${lib.pinned} part(s) pinned to it stay vendored)` : "Remove"} disabled={working || lib.scope === "default"} onClick={() => actions.remove(lib.id, lib.scope)} />
      </span>
    </div>
  );
}

export function LibrariesManager({ model, actions }: { model: LibrariesModel; actions: LibrariesActions }) {
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<"project" | "personal">("project");
  const [env, setEnv] = useState("");
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  const [drag, setDrag] = useState<Drag>();
  // dropped on another row of the same scope: move that many places within the scope's own order
  const drop = (from: string, to: string) => {
    setDrag(undefined);
    const lib = model.libraries.find((l) => rowKey(l) === from);
    if (!lib) return;
    const same = model.libraries.filter((l) => l.scope === lib.scope).map(rowKey);
    const delta = same.indexOf(to) - same.indexOf(from);
    if (delta && same.indexOf(to) >= 0) actions.move(lib.id, lib.scope, delta < 0 ? "up" : "down", Math.abs(delta));
  };
  const add = () => {
    if (!valid) return;
    actions.add(url.trim(), scope, env.trim() || undefined);
    setUrl("");
    setEnv("");
  };
  return (
    <PartsSurface place="editor">
      <ScrollArea className="size-full" contentClassName="mx-auto flex max-w-[1060px] flex-col gap-4 px-10 pt-7 pb-10 max-[640px]:px-4">
        <header className={BODY}>
          <h1 className="text-[22px] font-semibold text-fg">Libraries</h1>
          <p className="mt-1 text-[13px] text-fg-muted">Where parts come from, in search order.</p>
        </header>
        <AccountCard account={model.account} actions={actions} />
        <Card className="overflow-hidden">
          <div className={cx(GRID, BODY, "h-9 px-3 text-[12px] font-medium text-fg-muted")}>
            <span />
            <span>Library</span>
            <span className="max-[820px]:hidden">URL</span>
            <span className="max-[820px]:hidden">Parts</span>
            <span className="max-[820px]:hidden">Access</span>
            <span className="flex justify-end">{actions.check && <RowAction icon="refresh-cw" label="Check every library again" onClick={actions.check} />}</span>
          </div>
          {model.libraries.map((l, i) => (
            <LibraryRow key={rowKey(l)} lib={l} first={i === 0} last={i === model.libraries.length - 1} actions={actions} working={model.working} alone={model.libraries.filter((x) => x.scope === l.scope).length < 2} drag={drag} setDrag={setDrag} onDrop={drop} />
          ))}
          {!model.libraries.length && <p className={cx(BODY, "border-t border-line-subtle px-4 py-3 text-[13px] text-fg-muted")}>{model.noProject ? "Open a Protoboard project to see its libraries." : "No libraries yet."}</p>}
        </Card>
        <form
          className={cx(BODY, "flex flex-wrap items-center gap-2")}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="flex h-8 min-w-[240px] flex-[3_1_320px] items-center gap-2 rounded-[4px] border border-line bg-sunken px-2.5 focus-within:border-focus focus-within:outline focus-within:outline-1 focus-within:-outline-offset-1 focus-within:outline-focus">
            <Icon name="link" size={14} className="shrink-0 text-fg-muted" aria-hidden />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… a library that speaks uhd-library/v1" aria-label="Library URL" spellCheck={false} className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-fg outline-none placeholder:text-fg-faint" />
          </label>
          <label className="flex h-8 min-w-[150px] flex-[1_1_160px] items-center gap-2 rounded-[4px] border border-line bg-sunken px-2.5 focus-within:border-focus" data-tooltip="Only for a library that needs a token: the name of the environment variable holding it">
            <Icon name="key-round" size={14} className="shrink-0 text-fg-muted" aria-hidden />
            <input value={env} onChange={(e) => setEnv(e.target.value.toUpperCase())} placeholder="TOKEN_VARIABLE" aria-label="Token environment variable" spellCheck={false} className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-[12px] text-fg outline-none placeholder:text-fg-faint" />
          </label>
          <Select
            label="Where to add it"
            tooltip="Project: protoboard.config.ts, for everyone. Personal: your settings only"
            value={scope}
            onChange={(v) => setScope(v as "project" | "personal")}
            options={[
              { value: "project", label: "Project" },
              { value: "personal", label: "Personal" },
            ]}
            className="relative flex h-8 items-center gap-1 rounded-[4px] border border-[var(--pb-control-border)] px-2.5 text-[13px] text-fg hover:bg-hover"
            trigger={
              <>
                <Icon name={scope === "project" ? "folder" : "user"} size={14} aria-hidden />
                {scope === "project" ? "Project" : "Personal"}
                <Icon name="chevron-down" size={12} aria-hidden />
              </>
            }
          />
          <Button kind="primary" icon={model.working ? "loader" : "plus"} type="submit" disabled={!valid || model.working || model.noProject}>
            Add library
          </Button>
        </form>
        {model.problems.map((p) => (
          <p key={p} className={cx(BODY, "text-[12px] text-warning")}>
            {p}
          </p>
        ))}
        <Card className={cx(BODY, "flex items-center gap-3 px-4 py-3 text-[13px] text-fg")}>
          <Icon name="info" size={15} className="shrink-0 text-info" aria-hidden />
          Tokens come from an environment variable or your sign-in, never the project.
        </Card>
      </ScrollArea>
    </PartsSurface>
  );
}

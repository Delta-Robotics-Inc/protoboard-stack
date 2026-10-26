/**
 * Protoboard's settings, as a page in its own tab (PB-930): the account, the
 * version in use, the agents on this machine with Connect and Disconnect, the
 * entry for any other MCP client, and a way into VS Code's own settings (they
 * are linked, not repeated). A list of sections, so it can grow.
 */
import { useState, type ReactNode } from "react";
import { Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import { AccountCard } from "./LibrariesManager.js";
import type { AgentRowModel, SettingsActions, SettingsModel } from "./model.js";
import { PartsSurface } from "./Surface.js";
import { BODY, Button, Card, RowAction, StatusText, type Tone } from "./ui.js";

const STATUS: Record<AgentRowModel["status"], { tone: Tone; label: string }> = {
  connected: { tone: "ok", label: "Connected" },
  outdated: { tone: "warning", label: "Update needed" },
  "not-connected": { tone: "neutral", label: "Not connected" },
  unreadable: { tone: "error", label: "Cannot read its file" },
};

const DETAIL: Record<NonNullable<AgentRowModel["detailTone"]>, string> = { neutral: "text-fg-muted", ok: "text-ok", warning: "text-warning", error: "text-error" };

/** A section: its heading, a line about it, then its content. */
function Section({ title, note, right, children }: { title: string; note?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className={cx(BODY, "flex items-end gap-3")}>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {note && <p className="mt-0.5 text-[12.5px] leading-snug text-fg-muted">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const ROW = "grid grid-cols-[minmax(150px,1.2fr)_minmax(150px,0.9fr)_minmax(160px,2fr)_184px] items-center gap-3 max-[720px]:grid-cols-[minmax(0,1fr)_auto]";

function AgentRow({ agent, actions }: { agent: AgentRowModel; actions: SettingsActions }) {
  const s = STATUS[agent.status];
  const connected = agent.status === "connected";
  return (
    <div className={cx(BODY, "border-t border-line-subtle px-4 py-2 text-[13px]")} data-agent={agent.id} data-status={agent.status}>
      <div className={cx(ROW, "min-h-8")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="bot" size={15} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate text-fg">{agent.name}</span>
          </span>
          <span className="hidden max-[720px]:block">
            <StatusText tone={s.tone} plain>
              {s.label}
            </StatusText>
          </span>
          <span className="hidden min-w-0 items-center gap-1 max-[720px]:flex">
            <span className="truncate font-ui text-[11.5px] text-fg-muted" title={agent.file}>
              {agent.file}
            </span>
            <RowAction icon="file-braces" label="Open the configuration file" onClick={() => actions.openFile(agent.id)} />
          </span>
        </div>
        <span className="min-w-0 truncate max-[720px]:hidden">
          <StatusText tone={s.tone} plain>
            {s.label}
          </StatusText>
        </span>
        <span className="flex min-w-0 items-center gap-1 max-[720px]:hidden">
          <span className="truncate font-ui text-[12px] text-fg-muted" title={agent.file}>
            {agent.file}
          </span>
          <RowAction icon="file-braces" label="Open the configuration file" onClick={() => actions.openFile(agent.id)} />
        </span>
        <span className="flex items-center justify-end gap-1.5">
          {agent.status === "outdated" && (
            <Button size="sm" kind="primary" icon={agent.working ? "loader" : "refresh-cw"} disabled={agent.working} onClick={() => actions.connect(agent.id)}>
              Update
            </Button>
          )}
          {agent.status === "not-connected" && agent.manual && (
            <Button size="sm" icon="copy" onClick={() => actions.copy(agent.manual!, "command")}>
              Copy command
            </Button>
          )}
          {agent.status === "not-connected" && !agent.manual && (
            <Button size="sm" kind="primary" icon={agent.working ? "loader" : "plug"} disabled={agent.working} onClick={() => actions.connect(agent.id)}>
              Connect
            </Button>
          )}
          {(connected || agent.status === "outdated") && (
            <Button size="sm" icon={agent.working && connected ? "loader" : undefined} disabled={agent.working} onClick={() => actions.disconnect(agent.id)}>
              Disconnect
            </Button>
          )}
          {agent.status === "unreadable" && (
            <Button size="sm" icon="file-braces" onClick={() => actions.openFile(agent.id)}>
              Open file
            </Button>
          )}
        </span>
      </div>
      {agent.detail && <p className={cx("pt-0.5 pb-1 pl-[23px] text-[12px] leading-snug break-words", DETAIL[agent.detailTone ?? "neutral"])}>{agent.detail}</p>}
    </div>
  );
}

/** The entry for another client: the form picked, as text to copy. */
function OtherClients({ model, actions }: { model: NonNullable<SettingsModel["other"]>; actions: SettingsActions }) {
  const [form, setForm] = useState(model.forms[0]?.id);
  const shown = model.forms.find((f) => f.id === form) ?? model.forms[0];
  return (
    <Card className={cx(BODY, "flex flex-col gap-3 px-4 py-3 text-[13px] text-fg")}>
      <ol className="flex flex-col gap-1 text-[12.5px] leading-snug text-fg-muted">
        {model.steps.map((s, i) => (
          <li key={s} className="flex gap-2">
            <span className="shrink-0 font-ui text-fg-faint">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      {shown && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="tablist" aria-label="Format" className="flex flex-wrap items-center gap-1">
              {model.forms.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={f.id === shown.id}
                  onClick={() => setForm(f.id)}
                  className={cx(
                    "h-6 cursor-pointer rounded-[4px] border px-2 text-[12px] whitespace-nowrap",
                    f.id === shown.id ? "border-[var(--pb-control-border)] bg-active text-fg" : "border-transparent text-fg-muted hover:bg-hover hover:text-fg",
                    "outline-1 -outline-offset-1 outline-contrast focus-visible:outline focus-visible:outline-focus",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="ml-auto">
              <RowAction icon="copy" label={`Copy the ${shown.label}`} onClick={() => actions.copy(shown.text, shown.label)} />
            </span>
          </div>
          <ScrollArea className="max-h-[260px] rounded-[4px] border border-line bg-sunken" contentClassName="p-3">
            <pre className="m-0 font-ui text-[12px] leading-relaxed whitespace-pre text-fg" data-form={shown.id}>
              {shown.text}
            </pre>
          </ScrollArea>
        </div>
      )}
    </Card>
  );
}

export function SettingsPage({ model, actions }: { model: SettingsModel; actions: SettingsActions }) {
  const a = model.agents;
  return (
    <PartsSurface place="editor">
      <ScrollArea className="size-full" contentClassName="mx-auto flex max-w-[980px] min-w-[300px] flex-col gap-7 px-10 pt-7 pb-12 max-[640px]:px-4">
        <header className={BODY}>
          <h1 className="text-[22px] font-semibold text-fg">Protoboard settings</h1>
        </header>

        <Section title="Account">
          <AccountCard account={model.account} actions={actions} />
        </Section>

        <Section title="Protoboard">
          <Card className={cx(BODY, "flex flex-col text-[13px] text-fg")}>
            <div className="flex min-h-10 items-center gap-3 px-4 py-2">
              <span className="w-[88px] shrink-0 text-fg-muted">Version</span>
              <span className="min-w-0 flex-1">
                <span className="font-ui">{model.about.version}</span>
              </span>
            </div>
            <div className="flex min-h-10 items-center gap-3 border-t border-line-subtle px-4 py-2">
              <span className="w-[88px] shrink-0 text-fg-muted">CLI</span>
              <span className="min-w-0 flex-1">
                {model.about.problem ? (
                  <span className="text-warning">{model.about.problem}</span>
                ) : (
                  <>
                    <span className="font-ui text-[12px] break-all">{model.about.cli ?? "—"}</span>
                    {model.about.cliFrom && <span className="text-fg-muted"> · {model.about.cliFrom}</span>}
                  </>
                )}
              </span>
              {actions.showLog && <RowAction icon="scroll-text" label="Show the Protoboard log" onClick={actions.showLog} />}
            </div>
          </Card>
        </Section>

        <Section
          title="Agents"
          note="Connect an agent to give it Protoboard's tools."
          right={<RowAction icon="refresh-cw" label="Look for agents again" onClick={actions.refresh} />}
        >
          <Card className="overflow-hidden">
            <div className={cx(ROW, BODY, "h-9 px-4 text-[12px] font-medium text-fg-muted")}>
              <span>Agent</span>
              <span className="max-[720px]:hidden">Protoboard</span>
              <span className="max-[720px]:hidden">Configuration</span>
              <span />
            </div>
            {a.rows.map((r) => (
              <AgentRow key={r.id} agent={r} actions={actions} />
            ))}
            {!a.rows.length && (
              <p className={cx(BODY, "border-t border-line-subtle px-4 py-3 text-[13px]", a.state === "failed" ? "text-warning" : "text-fg-muted")}>
                {a.state === "loading" ? "Looking for agents…" : a.state === "failed" ? (a.problem ?? "The agents could not be listed.") : "No agents found. Use the entry below."}
              </p>
            )}
          </Card>
          {a.notFound.length > 0 && <p className={cx(BODY, "text-[12px] leading-snug text-fg-muted")}>Not found on this machine: {a.notFound.join(", ")}.</p>}
        </Section>

        {model.other && (
          <Section title="Other MCP clients" note="Add this entry to any other agent's MCP configuration.">
            <OtherClients model={model.other} actions={actions} />
          </Section>
        )}

        <Section title="More settings">
          <Card className={cx(BODY, "flex flex-col text-[13px] text-fg")}>
            <div className="flex min-h-11 items-center gap-3 px-4 py-2">
              <Icon name="settings" size={15} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                VS Code settings
                <span className="block text-[12px] text-fg-muted">CLI and Node.js paths, dev server port, check on save</span>
              </span>
              <Button size="sm" icon="external-link" onClick={actions.openVsCodeSettings}>
                Open
              </Button>
            </div>
            {actions.openLibraries && (
              <div className="flex min-h-11 items-center gap-3 border-t border-line-subtle px-4 py-2">
                <Icon name="library-big" size={15} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  Libraries
                  <span className="block text-[12px] text-fg-muted">Where parts come from, in search order</span>
                </span>
                <Button size="sm" icon="external-link" onClick={actions.openLibraries}>
                  Open
                </Button>
              </div>
            )}
            {actions.run &&
              (model.links ?? []).map((l) => (
                <div key={l.id} data-settings-link={l.id} className="flex min-h-11 items-center gap-3 border-t border-line-subtle px-4 py-2">
                  <Icon name={l.icon} size={15} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {l.label}
                    <span className="block text-[12px] break-words text-fg-muted">{l.note}</span>
                  </span>
                  <Button size="sm" icon="external-link" className="shrink-0" onClick={() => actions.run!(l.id)}>
                    {l.action}
                  </Button>
                </div>
              ))}
          </Card>
        </Section>
      </ScrollArea>
    </PartsSurface>
  );
}

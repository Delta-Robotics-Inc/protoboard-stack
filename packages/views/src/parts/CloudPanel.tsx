/**
 * The Cloud panel (PB-904, design 04): cloud information only, in its own
 * container. The account (the real sign-in), the project (name, what it is,
 * its libraries and parts, whether it is published), the releases and the
 * Manufacturing Package action, the cost estimate as a preview (the BOM
 * opens in its own tab), and quotes.
 */
import { Icon, ScrollArea, cx } from "@deltarobotics/uhd-viewer/components";
import type { CloudActions, CloudModel } from "./model.js";
import { PartsSurface } from "./Surface.js";
import { Avatar, BODY, Button, Card, SectionLabel, StatusText } from "./ui.js";

function Account({ model, actions }: { model: CloudModel; actions: CloudActions }) {
  const a = model.account;
  const signedIn = a.state === "signed-in";
  return (
    <div className={cx(BODY, "flex items-center gap-2.5")}>
      <Avatar email={signedIn ? a.email : undefined} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-fg">
          {signedIn ? (a.email ?? "Signed in") : a.state === "open" ? "No account needed" : a.state === "expired" ? "Sign in again" : a.state === "unknown" ? "Checking the sign-in…" : "Not signed in"}
        </p>
        <p className="truncate text-[11.5px] text-fg-muted">
          {signedIn
            ? (a.detail ?? (a.publisher ? "Publisher" : "Protoboard Cloud"))
            : a.state === "open"
              ? `${a.service ?? "The library"} signs no one in`
              : a.state === "expired"
                ? (a.problem ?? "The sign-in no longer works")
                : "Prices, quotes and publishing need an account"}
        </p>
      </div>
      {signedIn && actions.manageAccount && (
        <Button size="sm" icon="external-link" className="shrink-0" title="Manage Account" aria-label="Manage Account" onClick={actions.manageAccount}>
          Manage
        </Button>
      )}
      {!signedIn && a.state !== "open" && a.state !== "unknown" && actions.signIn && (
        <Button size="sm" kind="primary" icon="log-in" onClick={actions.signIn}>
          Sign in
        </Button>
      )}
    </div>
  );
}

export function CloudPanel({ model, actions }: { model: CloudModel; actions: CloudActions }) {
  const p = model.project;
  const c = model.cost;
  const running = model.release.state === "running";
  const latest = model.releases[0];
  const pct = c && c.bought ? Math.round((c.priced / c.bought) * 100) : 0;
  return (
    <PartsSurface place="sidebar">
      <ScrollArea className="size-full" contentClassName={cx(BODY, "flex min-w-[220px] flex-col gap-2 px-3 pt-1 pb-4")}>
        <SectionLabel icon="user">Account</SectionLabel>
        <Account model={model} actions={actions} />

        <SectionLabel icon="folder-kanban">Project</SectionLabel>
        <Card className="flex flex-col gap-1 px-3 py-2.5">
          <h2 className="truncate text-[14px] font-semibold text-fg">{p.name}</h2>
          {p.description && <p className="line-clamp-2 text-[12px] leading-snug text-fg-muted">{p.description}</p>}
          <p className="text-[12px] text-fg-muted">
            {[p.author, `${p.libraries} librar${p.libraries === 1 ? "y" : "ies"}`, p.parts !== undefined ? `${p.parts} parts` : ""].filter(Boolean).join(" · ")}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <span className="flex-1">{p.published ? <StatusText tone="ok">Published {p.published.at}</StatusText> : <StatusText tone="warning">Not published</StatusText>}</span>
            {actions.publish && (
              <Button size="sm" icon="cloud-upload" onClick={actions.publish} title="Publishing a project to Protoboard Cloud is not available yet">
                Publish
              </Button>
            )}
          </div>
        </Card>

        <SectionLabel icon="package">Releases</SectionLabel>
        {model.releases.length ? (
          model.releases.slice(0, 3).map((r) => (
            <div key={r.version} className="flex items-center gap-2.5 px-1">
              <Icon name="tag" size={14} strokeWidth={1.75} className="shrink-0 text-fg-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-ui text-[13px] text-fg">{r.version}</p>
                <p className="truncate text-[11.5px] text-fg-muted">{[r.date, r.units !== undefined ? `${r.units} unit${r.units === 1 ? "" : "s"}` : "", r.files !== undefined ? `${r.files} files` : ""].filter(Boolean).join(" · ")}</p>
              </div>
              {actions.openRelease && (
                <button type="button" aria-label={`Open release ${r.version}`} data-tooltip="Open the Manufacturing Package" onClick={() => actions.openRelease!(r.version)} className="grid size-6 cursor-pointer place-items-center rounded-[4px] text-fg-muted hover:bg-active hover:text-fg">
                  <Icon name="external-link" size={14} aria-hidden />
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="px-1 text-[12px] text-fg-muted">No release yet.</p>
        )}
        {actions.generate && (
          <Button kind="primary" icon={running ? "loader" : "package-check"} className="w-full" disabled={running} onClick={actions.generate}>
            {running ? (model.release.step ?? "Generating…") : "Generate Manufacturing Package"}
          </Button>
        )}
        {model.release.state === "failed" || model.release.state === "refused" ? (
          <div className="flex flex-col gap-0.5 px-1 text-[12px]">
            <p className="text-error">{model.release.message}</p>
            {(model.release.problems ?? []).slice(0, 4).map((x) => (
              <p key={x.code + x.message} className="text-fg-muted">
                {x.message}
              </p>
            ))}
          </div>
        ) : model.release.state === "done" && model.release.message ? (
          <p className="px-1 text-[12px] text-ok">{model.release.message}</p>
        ) : null}

        <SectionLabel icon="calculator">Cost estimate</SectionLabel>
        <Card className="flex flex-col gap-1.5 px-3 py-2.5">
          {c ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-ui text-[22px] leading-tight text-fg">{c.total}</span>
                <span className="text-[11.5px] text-fg-muted">per unit</span>
              </p>
              {c.order && <p className="font-ui text-[12px] text-fg">{c.order}</p>}
              {c.others.length > 0 && <p className="text-[11.5px] leading-snug text-fg-muted">{c.others.join(" · ")}</p>}
              <div role="progressbar" aria-label="Bought lines priced" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11.5px] leading-snug text-fg-muted">
                {c.priced} of {c.bought} bought lines priced · {c.unpriced} unpriced · {c.made} made (need a quote)
              </p>
              <div className="flex flex-col">
                {c.top.map((l) => (
                  <div key={l.item} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-fg">{l.item}</span>
                    <span className="font-ui text-fg">{l.price}</span>
                  </div>
                ))}
              </div>
              {actions.openBom && (
                <Button icon="sheet" className="w-full" onClick={actions.openBom}>
                  Open bill of materials
                </Button>
              )}
            </>
          ) : (
            <p className="text-[12px] text-fg-muted">{model.costMissing ?? "Check the project to estimate its cost."}</p>
          )}
        </Card>

        <SectionLabel icon="handshake">Quotes</SectionLabel>
        <Card className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 text-[12.5px] text-fg-muted">{model.quotes.length ? `${model.quotes.length} quote(s)` : "No quotes yet"}</span>
          {actions.requestQuote && (
            <Button size="sm" onClick={actions.requestQuote} title="Quotes from Protoboard Cloud are not available yet">
              Request quote
            </Button>
          )}
        </Card>
        {latest === undefined && actions.fetchOffers && c && !c.priced && (
          <button type="button" onClick={actions.fetchOffers} className="px-1 text-left text-[12px] text-link hover:underline">
            Get catalog offers to price the lines
          </button>
        )}
      </ScrollArea>
    </PartsSurface>
  );
}

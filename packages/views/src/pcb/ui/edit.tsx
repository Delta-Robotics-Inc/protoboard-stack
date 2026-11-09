/**
 * The editing pieces of the layout screen: the inspector's numeric fields in millimeters (each edit one
 * transaction, the same operations a drag sends), the selection's actions (rotate, flip, lock, delete), the
 * checkpoint dialog (save, show the prepared commit message, commit the board folder to Git; never a push) and the
 * plain report of a refused write.
 */
import { useEffect, useState } from "react";
import type { BoardRecord } from "../board.js";
import { numericFields, type NumericField } from "../edit/gestures.js";
import type { Outcome } from "../edit/session.js";
import { Icon } from "./icons.js";

export interface EditSectionProps {
  record: BoardRecord | undefined;
  count: number;
  writable: boolean;
  locked: boolean;
  canRotate: boolean;
  canDelete: boolean;
  onField: (field: NumericField, value: number) => void;
  onRotate: (deg: number) => void;
  onFlip: () => void;
  onLock: (lock: boolean) => void;
  onDelete: () => void;
  /** Rip up the unlocked copper of this net (copper.rip; absent: not in this core). */
  ripNet?: string;
  onRip?: () => void;
}

function NumberField({ label, value, unit, disabled, why, onCommit }: { label: string; value: number; unit: string; disabled: boolean; why?: string; onCommit: (v: number) => void }) {
  const shown = Number(value.toFixed(4)).toString();
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (Number.isFinite(v) && Number(v.toFixed(4)).toString() !== shown) onCommit(v);
    else setText(shown);
  };
  return (
    <label className="pcb-num" title={why ?? `${label} in ${unit === "°" ? "degrees" : "millimeters"}: Enter commits one change`}>
      <span>{label}</span>
      <input
        className="pcb-search"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          const el = e.target as HTMLInputElement;
          if (e.key === "Enter" || e.key === "Escape") {
            if (e.key === "Escape") setText(shown);
            // the blur commits (once); the screen takes the keyboard back (its shortcuts)
            el.blur();
            (el.closest(".pcb-screen") as HTMLElement | null)?.focus({ preventScroll: true });
          }
        }}
      />
      <span className="u">{unit}</span>
    </label>
  );
}

export function EditSection(p: EditSectionProps) {
  const fields = p.count === 1 ? numericFields(p.record) : [];
  if (!p.count) return null;
  return (
    <div className="pcb-sec">
      <h4>
        <span>Edit</span>
        <i>{p.writable ? "each change is one transaction" : "read only"}</i>
      </h4>
      {fields.length > 0 && (
        <div className="pcb-nums">
          {fields.map((f) => (
            <NumberField key={f.field} label={f.label} value={f.value} unit={f.unit} disabled={!p.writable || !f.editable} {...(f.why ? { why: f.why } : {})} onCommit={(v) => p.onField(f.field, v)} />
          ))}
        </div>
      )}
      <div className="acts" style={{ marginTop: fields.length ? 10 : 0 }}>
        <button className="pcb-btn" disabled={!p.writable || !p.canRotate} onClick={() => p.onRotate(90)} title="Rotate 90 degrees counterclockwise (R; Shift+R the other way)">
          <Icon name="rotate" size={12} /> R
        </button>
        <button className="pcb-btn" disabled={!p.writable || !p.canRotate} onClick={p.onFlip} title="Flip to the other side (Shift+F)">
          <Icon name="flip" size={12} /> Flip
        </button>
        <button className="pcb-btn" disabled={!p.writable} onClick={() => p.onLock(!p.locked)} title={p.locked ? "Unlock (L): agents and routers may then change it" : "Lock (L): agents and routers never change it"}>
          <Icon name={p.locked ? "unlock" : "lock"} size={12} /> {p.locked ? "Unlock" : "Lock"}
        </button>
        <button className="pcb-btn" disabled={!p.writable || !p.canDelete} onClick={p.onDelete} title="Delete (Del)">
          <Icon name="trash" size={12} />
        </button>
        {p.ripNet && p.onRip && (
          <button className="pcb-btn" disabled={!p.writable} onClick={p.onRip} title={`Remove the unlocked tracks and vias of ${p.ripNet}; locked copper stays`}>
            Rip up {p.ripNet}
          </button>
        )}
      </div>
    </div>
  );
}

export interface CheckpointDialogProps {
  seq: number;
  stage: "label" | "preparing" | "ready" | "committing" | "done";
  message?: string;
  result?: string;
  error?: string;
  onPrepare: (label: string) => void;
  onCommit: () => void;
  onClose: () => void;
}

export function CheckpointDialog(p: CheckpointDialogProps) {
  const [label, setLabel] = useState("board checkpoint");
  return (
    <div className="pcb-float pcb-dialog" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="row1">
        <b className="caps">Checkpoint · seq {p.seq}</b>
        <button className="pcb-btn ghost" onClick={p.onClose} title="Close (Esc)">
          <Icon name="close" size={12} />
        </button>
      </div>
      {p.stage === "label" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.onPrepare(label);
          }}
        >
          <input className="pcb-search" autoFocus value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Escape" && p.onClose()} />
          <p className="pcb-p">Saves the board, then prepares the commit message from the change sets since the last checkpoint. Nothing is committed until you say so; nothing is ever pushed.</p>
          <div className="acts">
            <button className="pcb-btn" type="submit">
              <Icon name="save" size={12} /> Save and prepare
            </button>
          </div>
        </form>
      )}
      {p.stage === "preparing" && <p className="pcb-p">Saving…</p>}
      {p.message !== undefined && p.stage !== "label" && <pre className="pcb-msg">{p.message}</pre>}
      {p.stage === "ready" && (
        <div className="acts">
          <button className="pcb-btn main" onClick={p.onCommit} title="git add and git commit of the board folder only">
            <Icon name="commit" size={12} /> Commit the board folder
          </button>
          <button className="pcb-btn" onClick={p.onClose}>
            Not now
          </button>
        </div>
      )}
      {p.stage === "committing" && <p className="pcb-p">Committing…</p>}
      {p.result && <div className="pcb-note pass">{p.result}</div>}
      {p.error && <div className="pcb-note fail">{p.error}</div>}
    </div>
  );
}

/** A refused or failed write, in plain words, until the next write or a dismiss. */
export function Toast({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  return (
    <div className={`pcb-toast ${outcome.ok ? "pass" : "fail"}`} role="status" onPointerDown={(e) => e.stopPropagation()}>
      <b className="caps">{outcome.ok ? "done" : outcome.status === "refused" ? `refused · ${outcome.reason ?? ""}` : outcome.status === "invalid" ? "not valid" : "failed"}</b>
      <span>
        {outcome.label}: {outcome.message}
      </span>
      <button className="pcb-btn ghost" onClick={onClose} title="Dismiss">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** The text tool's input, where the person clicked. */
export function TextPlacer({ x, y, onDone }: { x: number; y: number; onDone: (text: string | undefined) => void }) {
  const [t, setT] = useState("");
  return (
    <form
      className="pcb-placer"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onDone(t.trim() || undefined);
      }}
    >
      <input
        className="pcb-search"
        autoFocus
        maxLength={120}
        placeholder="Text on the top silkscreen, Enter"
        value={t}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onDone(undefined);
        }}
      />
    </form>
  );
}

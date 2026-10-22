import { Fragment, useState, type ReactNode } from 'react';
import { BookOpenText, CaretDown, CaretRight, SidebarSimple, X } from '@phosphor-icons/react';
import { parseInline, type GuideStep, type ModelingGuide, type PathPart } from '../lib/guide';

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-flinch-border bg-flinch-surface px-1.5 py-px font-mono text-[11px] leading-4 text-flinch-text shadow-[0_1px_0_var(--flinch-border)]">
      {children}
    </kbd>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 align-baseline">
      {keys.map((key, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-flinch-text-muted">+</span>}
          <Key>{key}</Key>
        </Fragment>
      ))}
    </span>
  );
}

function PathChain({ parts }: { parts: PathPart[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 align-baseline">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-flinch-text-muted" aria-hidden="true">&rsaquo;</span>}
          {part.kind === 'keys' ? (
            <Keys keys={part.keys} />
          ) : (
            <span className="rounded bg-flinch-accent/10 px-1.5 py-px text-[12px] text-flinch-accent">{part.value}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** Text with `code`, **bold**, keyboard shortcuts and menu paths rendered as UI chips. */
export function GuideInline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        switch (token.kind) {
          case 'bold':
            return <strong key={i} className="font-semibold text-flinch-text">{token.value}</strong>;
          case 'keys':
            return <Keys key={i} keys={token.keys} />;
          case 'path':
            return <PathChain key={i} parts={token.parts} />;
          case 'code':
            return <code key={i} className="rounded bg-flinch-deep px-1.5 py-px font-mono text-[11.5px] text-flinch-text">{token.value}</code>;
          default:
            return <Fragment key={i}>{token.value}</Fragment>;
        }
      })}
    </>
  );
}

function BodyLines({ lines }: { lines: string[] }) {
  const items: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    const list = bullets;
    bullets = [];
    items.push(
      <ul key={`ul-${items.length}`} className="mt-1.5 list-disc space-y-1 pl-4 marker:text-flinch-text-muted">
        {list.map((b, i) => <li key={i}><GuideInline text={b} /></li>)}
      </ul>,
    );
  };
  for (const line of lines) {
    const bullet = /^[-*\u2022]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
    } else {
      flush();
      items.push(<p key={`p-${items.length}`} className="mt-1.5 first:mt-0"><GuideInline text={line} /></p>);
    }
  }
  flush();
  return <>{items}</>;
}

function Step({ step }: { step: GuideStep }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-flinch-accent/30 bg-flinch-accent/15 text-[11px] font-semibold text-flinch-accent"
        aria-hidden="true"
      >
        {step.number}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-6 text-flinch-text">
          <span className="sr-only">Step {step.number}: </span>
          <GuideInline text={step.title} />
        </div>
        {step.body.length > 0 && (
          <div className="text-[12.5px] leading-relaxed text-flinch-text-dim"><BodyLines lines={step.body} /></div>
        )}
      </div>
    </li>
  );
}

/** Intro, numbered steps with badges, then the tips list. */
export function GuideBody({ guide }: { guide: ModelingGuide }) {
  return (
    <div className="space-y-4">
      {guide.intro.length > 0 && (
        <div className="text-[12.5px] leading-relaxed text-flinch-text-dim"><BodyLines lines={guide.intro} /></div>
      )}
      {guide.steps.length > 0 && (
        <ol className="space-y-3.5">
          {guide.steps.map((step, i) => <Step key={`${step.number}-${i}`} step={step} />)}
        </ol>
      )}
      {guide.tips.length > 0 && (
        <section className="rounded-md border border-flinch-border-dim bg-flinch-surface/40 p-3">
          <h4 className="mb-1.5 text-[12.5px] font-semibold text-flinch-text">{guide.tipsTitle ?? 'Tips'}</h4>
          <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-flinch-text-dim marker:text-flinch-text-muted">
            {guide.tips.map((tip, i) => <li key={i}><GuideInline text={tip} /></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

const stepCountLabel = (g: ModelingGuide) =>
  g.steps.length === 0 ? 'in progress' : `${g.steps.length} ${g.steps.length === 1 ? 'step' : 'steps'}`;

/** Collapsible card shown inside a chat message. */
export function GuideCard({ guide, onOpenBeside }: { guide: ModelingGuide; onOpenBeside?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-flinch-border bg-flinch-deep/60">
      <div className="flex items-center gap-1 bg-flinch-panel/60 pr-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-flinch-text hover:bg-flinch-surface/40 flinch-transition"
        >
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
          <span aria-hidden="true">&#128214;</span>
          <span>Manual modeling guide</span>
          <span className="ml-auto text-2xs font-normal text-flinch-text-muted">{stepCountLabel(guide)}</span>
        </button>
        {onOpenBeside && (
          <button
            type="button"
            onClick={onOpenBeside}
            title="Open the guide beside the editor and viewport"
            className="flex items-center gap-1 rounded px-2 py-1 text-2xs text-flinch-text-muted hover:bg-flinch-surface/60 hover:text-flinch-text flinch-transition"
          >
            <SidebarSimple size={12} />
            <span>Open beside editor</span>
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-[420px] overflow-y-auto border-t border-flinch-border-dim p-3"><GuideBody guide={guide} /></div>
      )}
    </div>
  );
}

/** Docked panel shown to the right of the editor and viewport. */
export function GuideDock({ guide, onClose }: { guide: ModelingGuide | null; onClose: () => void }) {
  return (
    <aside
      aria-label="Manual modeling guide"
      className="flex w-[360px] min-w-[300px] max-w-[45%] shrink-0 flex-col border-l border-flinch-border bg-flinch-base/90"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-flinch-border-dim px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-flinch-text">
          <BookOpenText size={16} className="text-flinch-accent" />
          <span>Manual modeling guide</span>
          {guide && guide.steps.length > 0 && (
            <span className="text-2xs font-normal text-flinch-text-muted">{stepCountLabel(guide)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close guide"
          className="rounded p-1 text-flinch-text-muted hover:bg-flinch-surface/60 hover:text-flinch-text flinch-transition"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {guide ? (
          <GuideBody guide={guide} />
        ) : (
          <p className="text-[12.5px] leading-relaxed text-flinch-text-muted">
            This reply has no modeling guide. Ask Flinch to build something and it will explain how to make the same model by hand in Blender.
          </p>
        )}
      </div>
    </aside>
  );
}

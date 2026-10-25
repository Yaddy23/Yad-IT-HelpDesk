import {
  type ProblemDetail,
  formatDate,
  getProblemPriorityBadgeClass,
  getProblemStatusBadgeClass,
  getRCATypeLabel,
  PROBLEM_STATUS_LABELS,
} from '@/lib/problemApi';

import { badgeBase, cardBase, sectionTitle } from './styles';

interface Props {
  problem: ProblemDetail;
}

/** A label/value pair in the metadata grid. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

/** Affected services/assets/CIs are free-text arrays — render them as chips, or a dash when empty. */
function ChipList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function ProblemDetailsTab({ problem }: Props) {
  return (
    <div className="space-y-4">
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Summary</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <span className={`${badgeBase} ${getProblemStatusBadgeClass(problem.status)}`}>
              {PROBLEM_STATUS_LABELS[problem.status]}
            </span>
          </Field>
          <Field label="Priority">
            <span className={`${badgeBase} ${getProblemPriorityBadgeClass(problem.priority)}`}>
              {problem.priority}
            </span>
          </Field>
          <Field label="Owner">{problem.owner.name}</Field>
          <Field label="RCA method">{getRCATypeLabel(problem.rcaType)}</Field>
        </dl>
      </section>

      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Description</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm">{problem.description}</p>
      </section>

      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Business impact</h2>
        {problem.businessImpact.trim() ? (
          <p className="mt-3 whitespace-pre-wrap text-sm">{problem.businessImpact}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No business impact recorded.</p>
        )}
      </section>

      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Affected items</h2>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Services</p>
            <div className="mt-1.5">
              <ChipList items={problem.affectedServices} emptyLabel="No services recorded." />
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Assets</p>
            <div className="mt-1.5">
              <ChipList items={problem.affectedAssets} emptyLabel="No assets recorded." />
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Configuration items
            </p>
            <div className="mt-1.5">
              <ChipList items={problem.affectedCIs} emptyLabel="No CIs recorded." />
            </div>
          </div>
        </div>
      </section>

      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Lifecycle timeline</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Identified">{formatDate(problem.identifiedAt)}</Field>
          <Field label="Investigation started">{formatDate(problem.investigationStartedAt)}</Field>
          <Field label="Root cause identified">{formatDate(problem.rootCauseIdentifiedAt)}</Field>
          <Field label="Workaround documented">{formatDate(problem.workaroundDocumentedAt)}</Field>
          <Field label="Change initiated">{formatDate(problem.changeInitiatedAt)}</Field>
          <Field label="Resolved">{formatDate(problem.resolvedAt)}</Field>
          <Field label="Closed">{formatDate(problem.closedAt)}</Field>
          <Field label="Last updated">{formatDate(problem.updatedAt)}</Field>
        </dl>
      </section>
    </div>
  );
}

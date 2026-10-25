import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangleIcon, CheckCircleIcon, FileTextIcon, TrendingUpIcon } from '@/components/icons';

import { useDashboard } from '@/lib/problemApi';
import {
  ProblemTrendChart,
  ProblemParetoChart,
  ProblemAgingChart,
  ProblemStatusChart,
  KnownErrorStatusChart,
  FixEffectivenessChart,
} from '@/components/problems/ProblemCharts';
import { buttonPrimary, inputBase, labelBase } from '@/components/problems/styles';

/** Date range options for the dashboard. */
const DATE_RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
] as const;

/**
 * A single KPI stat tile — clickable link to the relevant list view.
 */
function KPIStatTile({
  label,
  value,
  href,
  icon: Icon,
  trend,
  trendUp = true,
}: {
  label: string;
  value: number | string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  trendUp?: boolean;
}) {
  return (
    <Link
      to={href}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 hover:border-primary/50 transition-colors"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-foreground">{value}</span>
        {trend && (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${
              trendUp ? 'text-success' : 'text-destructive'
            }`}
          >
            {trendUp ? <TrendingUpIcon className="h-3 w-3" /> : <TrendingUpIcon className="h-3 w-3 rotate-180" />}
            {trend}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Skeleton loader for KPI tiles. */
function KPIStatTileSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="h-4 w-24 bg-muted rounded" />
      <div className="mt-3 h-8 w-32 bg-muted rounded" />
    </div>
  );
}

/** Skeleton loader for charts. */
function ChartCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="h-4 w-48 bg-muted rounded mb-4" />
      <div className="h-64 bg-muted rounded" />
    </div>
  );
}

/**
 * Problems Dashboard page — KPI tiles + charts grid + date range picker.
 */
export default function ProblemsDashboardPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useDashboard(days);

  const handleRangeChange = (newDays: number) => {
    setDays(newDays);
    // refetch is automatic because queryKey includes days
  };

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
        <AlertTriangleIcon className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-destructive">Failed to load dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <button
          onClick={() => refetch()}
          className={buttonPrimary}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + date range */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Problems Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregate view of problem trends, aging, and fix effectiveness.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="dashboard-range" className={labelBase}>
            Time range
          </label>
          <select
            id="dashboard-range"
            value={days}
            onChange={(e) => handleRangeChange(Number(e.target.value))}
            disabled={isLoading}
            className={inputBase}
          >
            {DATE_RANGES.map(({ label, days: d }) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
          {isLoading && (
            <span className="flex h-5 w-5 items-center justify-center">
              <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* KPI Stat Tiles Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="region" aria-label="Key metrics">
        {isLoading ? (
          Array.from({ length: 4 }, (_, i) => <KPIStatTileSkeleton key={i} />)
        ) : (
          <>
            <KPIStatTile
              label="Open Problems"
              value={data?.open ?? 0}
              href="/problems?status=IDENTIFIED,INVESTIGATION,ROOT_CAUSE_KNOWN,WORKAROUND_DOCUMENTED,PENDING_CHANGE"
              icon={FileTextIcon}
              trend="+0%"
            />
            <KPIStatTile
              label="Overdue Investigations"
              value={data?.overdue ?? 0}
              href="/problems?status=INVESTIGATION,ROOT_CAUSE_KNOWN"
              icon={AlertTriangleIcon}
              trend="+0%"
              trendUp={false}
            />
            <KPIStatTile
              label="Problems with Known Error"
              value={data?.knownErrors.problemsWithKnownError ?? 0}
              href="/known-errors"
              icon={CheckCircleIcon}
              trend="+0%"
            />
            <KPIStatTile
              label="Fix Verified Rate"
              value={
                data?.fixEffectiveness && data.fixEffectiveness.resolved > 0
                  ? `${Math.round((data.fixEffectiveness.verifiedFix / data.fixEffectiveness.resolved) * 100)}%`
                  : '—'
              }
              href="/problems?status=RESOLVED"
              icon={TrendingUpIcon}
              trend="+0%"
            />
          </>
        )}
      </div>

      {/* Charts Grid */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3" role="region" aria-label="Charts">
        {isLoading ? (
          Array.from({ length: 6 }, (_, i) => <ChartCardSkeleton key={i} />)
        ) : (
          <>
            <ProblemTrendChart data={data?.trends ?? []} />
            <ProblemParetoChart data={data?.topCauses ?? []} />
            <ProblemAgingChart data={data?.aging ?? []} />
            <ProblemStatusChart data={data?.statusDistribution ?? []} />
            <KnownErrorStatusChart data={data?.knownErrors.byStatus ?? []} />
            <FixEffectivenessChart data={data?.fixEffectiveness} />
          </>
        )}
      </div>
    </div>
  );
}
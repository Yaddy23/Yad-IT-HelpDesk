import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

import type { ProblemDashboard, KnownErrorStatus } from '@/lib/problemApi';
import { KNOWN_ERROR_STATUS_LABELS } from '@/lib/problemApi';

/**
 * Semantic color tokens used by the dashboard charts.
 * These map to the Tailwind v4 semantic palette so charts adapt to
 * light/dark mode without extra work. The exact hex values are read
 * from CSS custom properties at runtime via the `style` prop.
 */
const CHART_COLORS = {
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  accent: 'var(--color-accent)',
  muted: 'var(--color-muted)',
  destructive: 'var(--color-destructive)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  foreground: 'var(--color-foreground)',
  mutedForeground: 'var(--color-muted-foreground)',
  border: 'var(--color-border)',
  card: 'var(--color-card)',
} as const;

/** A minimal card wrapper used by every chart so spacing stays consistent. */
function ChartCard({
  title,
  children,
  className = '',
  heightClass = 'h-64',
}: { title: string; children: React.ReactNode; className?: string; heightClass?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>
      <h3 className="mb-4 text-sm font-medium text-foreground">{title}</h3>
      <div className={heightClass}>{children}</div>
    </div>
  );
}

/** Reusable tooltip content for line/area charts. */
function LineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded bg-card border border-border p-2 text-xs"
      style={{ boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
    >
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-mono font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Reusable tooltip for bar charts. */
function BarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded bg-card border border-border p-2 text-xs"
      style={{ boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
    >
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-mono font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Reusable tooltip for pie charts. */
function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded bg-card border border-border p-2 text-xs"
      style={{ boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
    >
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-mono font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Trend chart: problems identified per day over the selected window.
 * Line chart with a single series — no legend needed; title carries identity.
 */
export function ProblemTrendChart({ data }: { data: ProblemDashboard['trends'] }) {
  if (!data?.length) return <ChartCard title="Problem Trends">No data</ChartCard>;

  return (
    <ChartCard title="Problems Identified (Daily)">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_COLORS.border}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={{ stroke: CHART_COLORS.border }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<LineTooltip />} />
          <Line
            type="monotone"
            dataKey="problems"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            dot={{ fill: CHART_COLORS.primary, strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Pareto chart: top incident categories by problem count (bar chart).
 * Top 8 + "Other" — horizontal bars for readability.
 */
export function ProblemParetoChart({ data }: { data: ProblemDashboard['topCauses'] }) {
  if (!data?.length) return <ChartCard title="Top Causes (Pareto)">No data</ChartCard>;

  // Use a qualitative palette for categorical identity
  const PALETTE = [
    CHART_COLORS.primary,
    CHART_COLORS.secondary,
    CHART_COLORS.accent,
    CHART_COLORS.warning,
    CHART_COLORS.success,
    CHART_COLORS.destructive,
    CHART_COLORS.muted,
    '#8b5cf6', // violet
    '#ec4899', // pink
  ];

  return (
    <ChartCard title="Top Incident Categories">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.border} horizontal={false} />
          <XAxis
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <YAxis
            dataKey="name"
            type="category"
            width={140}
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<BarTooltip />} />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Aging chart: open problems bucketed by age.
 * Bar chart with sequential color (darker = older).
 */
export function ProblemAgingChart({ data }: { data: ProblemDashboard['aging'] }) {
  if (!data?.length) return <ChartCard title="Problem Aging">No data</ChartCard>;

  // Sequential color ramp using CSS color-mix for opacity (Tailwind's /opacity syntax
  // only works in utility classes, not raw CSS variable references)
  const AGING_COLORS = [
    'var(--color-primary)',
    'color-mix(in srgb, var(--color-primary) 80%, transparent)',
    'color-mix(in srgb, var(--color-primary) 60%, transparent)',
    'color-mix(in srgb, var(--color-primary) 40%, transparent)',
  ];

  return (
    <ChartCard title="Open Problems by Age">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.border} vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={{ stroke: CHART_COLORS.border }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<BarTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {data.map((_, i) => (
              <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Status distribution pie chart.
 * Uses status semantic colors matching the status badge palette for consistency.
 */
export function ProblemStatusChart({ data }: { data: ProblemDashboard['statusDistribution'] }) {
  if (!data?.length) return <ChartCard title="Status Distribution">No data</ChartCard>;

  const STATUS_COLORS: Record<string, string> = {
    IDENTIFIED: 'var(--color-gray-500)',
    INVESTIGATION: 'var(--color-blue-500)',
    ROOT_CAUSE_KNOWN: 'var(--color-purple-500)',
    WORKAROUND_DOCUMENTED: 'var(--color-amber-500)',
    PENDING_CHANGE: 'var(--color-orange-500)',
    RESOLVED: 'var(--color-green-500)',
    CLOSED: 'var(--color-slate-500)',
  };

  return (
    <ChartCard title="Problems by Status" heightClass="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="count"
            nameKey="status"
            label={false}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={STATUS_COLORS[entry.status] || CHART_COLORS.muted}
              />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
            formatter={(value) => value.replaceAll('_', ' ')}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Known Errors status pie chart.
 */
export function KnownErrorStatusChart({
  data,
}: {
  data: ProblemDashboard['knownErrors']['byStatus'];
}) {
  if (!data?.length) return <ChartCard title="Known Errors by Status">No data</ChartCard>;

  const KE_STATUS_COLORS: Record<string, string> = {
    DRAFT: 'var(--color-gray-500)',
    UNDER_REVIEW: 'var(--color-yellow-500)',
    PUBLISHED: 'var(--color-green-500)',
    RETIRED: 'var(--color-red-500)',
  };

  return (
    <ChartCard title="Known Errors by Status" heightClass="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="count"
            nameKey="status"
            label={false}
            labelLine={false}
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={KE_STATUS_COLORS[entry.status] || CHART_COLORS.muted}
              />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
            formatter={(value) => KNOWN_ERROR_STATUS_LABELS[value as KnownErrorStatus] ?? value}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Fix Effectiveness: stacked bar showing resolved total, verified fix, and exception.
 */
export function FixEffectivenessChart({ data }: { data: ProblemDashboard['fixEffectiveness'] | undefined }) {
  if (!data) return <ChartCard title="Fix Effectiveness">No data</ChartCard>;

  const { resolved, verifiedFix, exception } = data;
  const unverified = resolved - verifiedFix - exception;

  return (
    <ChartCard title="Fix Effectiveness">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[
            { name: 'Resolved', verifiedFix, unverified: Math.max(0, unverified), exception },
          ]}
          layout="vertical"
          margin={{ top: 5, right: 5, left: 5, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.border} horizontal={false} />
          <XAxis
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={['auto', 'auto']}
          />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<BarTooltip />} />
          <Legend wrapperStyle={{ paddingTop: 8 }} iconType="circle" iconSize={8} />
          <Bar dataKey="verifiedFix" stackId="a" fill="var(--color-success)" name="Verified Fix" maxBarSize={24} />
          <Bar dataKey="unverified" stackId="a" fill="var(--color-warning)" name="Unverified" maxBarSize={24} />
          <Bar dataKey="exception" stackId="a" fill="var(--color-destructive)" name="Exception" maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
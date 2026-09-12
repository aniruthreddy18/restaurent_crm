"use client";

// Charts render their final geometry immediately (isAnimationActive={false}):
// entry animation adds nothing to an ops dashboard, and recharts leaves shapes
// at their zero-size start state under React StrictMode's double-mount.

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Palette ordered so adjacent slices stay distinguishable. */
const PALETTE = [
  "var(--color-brand)",
  "var(--color-info)",
  "var(--color-ok)",
  "var(--color-warn)",
  "var(--color-ink-subtle)",
];

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid var(--color-line)",
  fontSize: 12,
  background: "var(--color-surface)",
};

export function CategoryBarChart({
  data,
  dataKey = "count",
  labelKey = "label",
}: {
  data: Record<string, string | number>[];
  dataKey?: string;
  labelKey?: string;
}) {
  return (
    <div className="h-64 w-full px-2 pb-2 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey={labelKey}
            tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-muted)" }} />
          <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((_, index) => (
              <Cell key={index} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChart({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="h-64 w-full pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={52}
            outerRadius={80}
            paddingAngle={2}
            isAnimationActive={false}
          >
            {data.map((_, index) => (
              <Cell key={index} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              `${value} (${total ? Math.round((Number(value) / total) * 100) : 0}%)`,
              String(name),
            ]}
          />
          <Legend
            verticalAlign="bottom"
            height={28}
            iconType="circle"
            formatter={(value) => <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HorizontalBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-72 w-full px-2 pb-2 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--color-line)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "var(--color-ink-muted)" }}
            tickLine={false}
            axisLine={false}
            width={140}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-surface-muted)" }} />
          <Bar dataKey="value" fill="var(--color-brand)" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

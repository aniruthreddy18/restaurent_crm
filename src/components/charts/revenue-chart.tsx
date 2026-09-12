"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type RevenuePoint = { date: string; label: string; revenue: number; orders: number };

export function RevenueChart({ data, currency = "INR" }: { data: RevenuePoint[]; currency?: string }) {
  const format = (value: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

  return (
    <div className="h-64 w-full px-2 pb-2 pt-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v) => format(Number(v))}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid var(--color-line)",
              fontSize: 12,
              background: "var(--color-surface)",
            }}
            formatter={(value, name) =>
              name === "revenue" ? [format(Number(value)), "Revenue"] : [String(value), "Orders"]
            }
          />
          {/*
            Entry animation is purely decorative on an operations dashboard,
            and recharts' animation manager leaves shapes at their zero-size
            start state under React StrictMode's double-mount. Rendering the
            final geometry immediately is both more robust and kinder to
            anyone who has reduced motion turned on.
          */}
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--color-brand)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

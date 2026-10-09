'use client';

import { useId, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Report charts (05 §4.4). Each is one series in the single chart hue (--chart-1), with
// recessive axes and grid, a hover tooltip, and the same numbers as a table for screen readers
// and exact reading.

const AXIS = { stroke: 'var(--muted-foreground)', fontSize: 12, tickLine: false } as const;
const TOOLTIP = {
  contentStyle: {
    background: 'var(--popover)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--popover-foreground)',
    fontSize: 12,
  },
  cursor: { fill: 'var(--muted)', opacity: 0.5 },
} as const;

export interface Point {
  label: string;
  value: number;
}

function Figure({
  title,
  points,
  format,
  children,
}: {
  title: string;
  points: Point[];
  format: (value: number) => string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <figure
      aria-labelledby={id}
      className="grid animate-fade-up gap-3 rounded-2xl border bg-card p-5 shadow-soft"
    >
      <figcaption id={id} className="font-heading text-base font-semibold">
        {title}
      </figcaption>
      {points.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data for this range.</p>
      ) : (
        <>
          <div className="h-64" aria-hidden>
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 600, height: 256 }}
            >
              {children}
            </ResponsiveContainer>
          </div>
          <details className="text-sm">
            <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Show data
            </summary>
            <table className="mt-3 w-full">
              <caption className="sr-only">{title}</caption>
              <tbody>
                {points.map((p) => (
                  <tr
                    key={p.label}
                    className="border-b transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <th scope="row" className="px-2 py-1.5 text-left font-normal">
                      {p.label}
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums">{format(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  );
}

export function LineFigure({
  title,
  points,
  format,
}: {
  title: string;
  points: Point[];
  format: (v: number) => string;
}) {
  return (
    <Figure title={title} points={points} format={format}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" {...AXIS} axisLine={false} minTickGap={24} />
        <YAxis {...AXIS} axisLine={false} width={72} tickFormatter={format} />
        <Tooltip {...TOOLTIP} formatter={(v) => format(Number(v))} />
        <Line
          type="monotone"
          dataKey="value"
          name={title}
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
        />
      </LineChart>
    </Figure>
  );
}

export function BarFigure({
  title,
  points,
  format,
}: {
  title: string;
  points: Point[];
  format: (v: number) => string;
}) {
  return (
    <Figure title={title} points={points} format={format}>
      <BarChart
        data={points}
        layout="vertical"
        margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
        barCategoryGap={4}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" {...AXIS} axisLine={false} tickFormatter={format} />
        <YAxis type="category" dataKey="label" {...AXIS} axisLine={false} width={120} />
        <Tooltip {...TOOLTIP} formatter={(v) => format(Number(v))} />
        <Bar
          dataKey="value"
          name={title}
          fill="var(--chart-1)"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
        />
      </BarChart>
    </Figure>
  );
}

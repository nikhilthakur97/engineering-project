import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
  "#a855f7", "#e11d48",
];

interface Props {
  data: Record<string, any>[];
  categories: string[];
}

export default function SpendingChart({ data, categories }: Props) {
  const formatted = useMemo(() => data.map((row) => {
    if (!row.month || !row.month.includes("-")) return row;
    const [year, month] = row.month.split("-");
    const date = new Date(Number(year), Number(month) - 1);
    return {
      ...row,
      month: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    };
  }), [data]);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={formatted} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v.toLocaleString()}`}
        />
        <Tooltip
          formatter={(value: number, name: string) => [
            `$${value.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
            name,
          ]}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            fontSize: "12px",
            backgroundColor: "#ffffff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: "250px",
            overflowY: "auto",
          }}
          itemStyle={{ padding: "1px 0" }}
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          wrapperStyle={{ zIndex: 10 }}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        {categories.map((cat, i) => (
          <Bar
            key={cat}
            dataKey={cat}
            stackId="spending"
            fill={COLORS[i % COLORS.length]}
            radius={i === categories.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

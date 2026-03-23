const FLAG_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high_value: { bg: "bg-amber-100", text: "text-amber-800", label: "High Value" },
  unusual_amount: { bg: "bg-red-100", text: "text-red-800", label: "Unusual Amount" },
  possible_duplicate: { bg: "bg-orange-100", text: "text-orange-800", label: "Duplicate?" },
  incomplete: { bg: "bg-gray-100", text: "text-gray-800", label: "Incomplete" },
};

export default function AnomalyBadge({ flag }: { flag: string }) {
  const style = FLAG_STYLES[flag] || {
    bg: "bg-blue-100",
    text: "text-blue-800",
    label: flag,
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

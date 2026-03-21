import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCategories, type Category } from "../lib/api";

interface Props {
  initial?: {
    date?: string;
    description?: string;
    amount?: number;
    categoryId?: number | null;
  };
  onSubmit: (data: {
    date: string;
    description: string;
    amount: number;
    categoryId: number | null;
  }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function TransactionForm({
  initial,
  onSubmit,
  onCancel,
  loading,
}: Props) {
  const [date, setDate] = useState(initial?.date?.slice(0, 10) || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [amount, setAmount] = useState(initial?.amount?.toString() || "");
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId?.toString() || ""
  );

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      date,
      description,
      amount: Number(amount),
      categoryId: categoryId ? Number(categoryId) : null,
    });
  }

  const inputClass =
    "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date
        </label>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Amazon Purchase"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Amount ($)
        </label>
        <input
          type="number"
          required
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className={inputClass}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Category
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputClass}
        >
          <option value="">— Uncategorized —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

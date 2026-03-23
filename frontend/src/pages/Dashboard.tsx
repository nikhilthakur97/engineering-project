import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchDashboardSummary,
  fetchSpending,
  fetchTransactions,
  fetchCategories,
  bulkAction,
  updateTransaction,
  deleteTransaction,
  type Transaction,
  type Category,
} from "../lib/api";
import AnomalyBadge from "../components/AnomalyBadge";
import TransactionForm from "../components/TransactionForm";
import SpendingChart from "../components/SpendingChart";
import { useState, useMemo } from "react";

type Tab = "uncategorized" | "flagged" | "needsReview";

export default function Dashboard() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("uncategorized");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const { data: summary } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboardSummary,
    refetchInterval: 10000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });

  const { data: spending } = useQuery({
    queryKey: ["spending"],
    queryFn: () => fetchSpending(24),
  });

  const params = useMemo(() => {
    switch (tab) {
      case "uncategorized":
        return { categoryId: "null", limit: 100 };
      case "flagged":
        return { flagged: "true", limit: 100 };
      case "needsReview":
        return { needsReview: "true", limit: 100 };
    }
  }, [tab]);

  const { data: txResponse } = useQuery({
    queryKey: ["review", tab],
    queryFn: () => fetchTransactions(params),
  });

  const transactions = txResponse?.data || [];

  const approveMutation = useMutation({
    mutationFn: (ids: number[]) => bulkAction({ ids, action: "approve" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSelected(new Set());
    },
  });

  const categorizeMutation = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: number[]; categoryId: number }) =>
      bulkAction({ ids, action: "categorize", categoryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSelected(new Set());
      setBulkCategoryId("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: Record<string, any>) =>
      updateTransaction(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map((t) => t.id)));
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Review Dashboard</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total", value: summary?.total ?? "—", color: "text-gray-900", tab: null },
          { label: "Uncategorized", value: summary?.uncategorized ?? "—", color: "text-yellow-700", tab: "uncategorized" as Tab },
          { label: "Flagged", value: summary?.flagged ?? "—", color: "text-red-700", tab: "flagged" as Tab },
          { label: "Needs Review", value: summary?.needsReview ?? "—", color: "text-indigo-700", tab: "needsReview" as Tab },
        ].map((card) => (
          <div
            key={card.label}
            onClick={() => {
              if (card.tab) {
                setTab(card.tab);
                setSelected(new Set());
              }
            }}
            className={`bg-white rounded-xl border border-gray-200 p-4 transition-colors ${
              card.tab
                ? "cursor-pointer hover:border-indigo-300 hover:shadow-sm"
                : ""
            } ${card.tab && card.tab === tab ? "border-indigo-400 ring-1 ring-indigo-100" : ""}`}
          >
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {card.label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${card.color}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Spending chart */}
      {spending && spending.data.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Monthly Spending
          </h3>
          <SpendingChart data={spending.data} categories={spending.categories} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-4">
        {([
          { key: "uncategorized" as Tab, label: "Uncategorized" },
          { key: "flagged" as Tab, label: "Flagged Anomalies" },
          { key: "needsReview" as Tab, label: "Needs Review" },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSelected(new Set());
            }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-indigo-50 rounded-lg">
          <span className="text-sm font-medium text-indigo-700">
            {selected.size} selected
          </span>
          {(tab === "uncategorized" || tab === "needsReview") && (
            <>
              <select
                value={bulkCategoryId}
                onChange={(e) => setBulkCategoryId(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1"
              >
                <option value="">Categorize as…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!bulkCategoryId}
                onClick={() =>
                  categorizeMutation.mutate({
                    ids: [...selected],
                    categoryId: Number(bulkCategoryId),
                  })
                }
                className="text-sm px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                Apply
              </button>
            </>
          )}
          <button
            onClick={() => approveMutation.mutate([...selected])}
            className="text-sm px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Approve All
          </button>
        </div>
      )}

      {/* Transaction table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={
                    transactions.length > 0 &&
                    selected.size === transactions.length
                  }
                  onChange={toggleAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Date
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Description
              </th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">
                Amount
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Category
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Flags
              </th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  {tab === "uncategorized"
                    ? "All transactions are categorized!"
                    : tab === "flagged"
                      ? "No flagged anomalies — everything looks good."
                      : "Nothing needs review — all clear!"}
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(tx.id)}
                      onChange={() => toggleSelect(tx.id)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {editingId === tx.id ? (
                      <TransactionForm
                        initial={{
                          date: tx.date,
                          description: tx.description || "",
                          amount: tx.amount,
                          categoryId: tx.categoryId,
                        }}
                        onSubmit={(data) =>
                          updateMutation.mutate({ id: tx.id, ...data })
                        }
                        onCancel={() => setEditingId(null)}
                        loading={updateMutation.isPending}
                      />
                    ) : (
                      tx.description || (
                        <span className="text-gray-400 italic">
                          No description
                        </span>
                      )
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-900">
                    {fmt(tx.amount)}
                  </td>
                  <td className="px-4 py-3">
                    {tx.category ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                        {tx.category.name}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tx.anomalyFlags.map((f) => (
                        <AnomalyBadge key={f} flag={f} />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId !== tx.id && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() =>
                            approveMutation.mutate([tx.id])
                          }
                          className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setEditingId(tx.id)}
                          className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Delete this transaction?"))
                              deleteMutation.mutate(tx.id);
                          }}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

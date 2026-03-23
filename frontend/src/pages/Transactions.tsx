import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  fetchTransactions,
  fetchCategories,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  bulkAction,
  type Category,
  type TransactionPayload,
} from "../lib/api";
import AnomalyBadge from "../components/AnomalyBadge";
import ReviewReasons from "../components/ReviewReasons";
import TransactionForm from "../components/TransactionForm";
import CsvUpload from "../components/CsvUpload";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function Transactions() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [cursor, setCursor] = useState<number | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 300);
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get("categoryId") || ""
  );
  const [needsReviewFilter, setNeedsReviewFilter] = useState(
    searchParams.get("needsReview") || ""
  );

  const resetListState = useCallback(() => {
    setCursor(undefined);
    setSelected(new Set());
  }, []);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (categoryFilter) params.categoryId = categoryFilter;
    if (needsReviewFilter) params.needsReview = needsReviewFilter;
    return params;
  }, [categoryFilter, needsReviewFilter, debouncedSearch]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });

  const { data: txResponse, isLoading } = useQuery({
    queryKey: ["transactions", cursor, queryParams],
    queryFn: () =>
      fetchTransactions({ limit: 50, cursor, ...queryParams }),
  });

  const transactions = txResponse?.data || [];

  const createMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setShowAdd(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...body
    }: Partial<TransactionPayload> & {
      id: number;
      needsReview?: boolean;
      anomalyFlags?: string[];
    }) =>
      updateTransaction(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: bulkAction,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setSelected(new Set());
      setBulkCategoryId("");
    },
  });

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Transactions</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowImport(!showImport);
              setShowAdd(false);
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
          >
            Import CSV
          </button>
          <button
            onClick={() => {
              setShowAdd(!showAdd);
              setShowImport(false);
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            + Add Transaction
          </button>
        </div>
      </div>

      {/* CSV Upload */}
      {showImport && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Import from CSV
          </h3>
          <CsvUpload
            onComplete={() => {
              qc.refetchQueries({ queryKey: ["transactions"] });
              qc.invalidateQueries({ queryKey: ["dashboard"] });
              qc.invalidateQueries({ queryKey: ["categories"] });
            }}
          />
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200 max-w-lg">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            New Transaction
          </h3>
          <TransactionForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowAdd(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search description…"
          value={searchInput}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          onChange={(e) => {
            setSearchInput(e.target.value);
            resetListState();
          }}
        />
        <select
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            resetListState();
          }}
        >
          <option value="">All Categories</option>
          <option value="null">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          value={needsReviewFilter}
          onChange={(e) => {
            setNeedsReviewFilter(e.target.value);
            resetListState();
          }}
        >
          <option value="">All Status</option>
          <option value="true">Needs Review</option>
          <option value="false">Reviewed</option>
        </select>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 p-3 bg-indigo-50 rounded-lg">
          <span className="text-sm font-medium text-indigo-700">
            {selected.size} selected
          </span>
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
              bulkMutation.mutate({
                ids: [...selected],
                action: "categorize",
                categoryId: Number(bulkCategoryId),
              })
            }
            className="text-sm px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() =>
              bulkMutation.mutate({ ids: [...selected], action: "approve" })
            }
            className="text-sm px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Approve
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete ${selected.size} transactions?`))
                bulkMutation.mutate({ ids: [...selected], action: "delete" });
            }}
            className="text-sm px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      )}

      {/* Table */}
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
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No transactions found.
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
                  <td className="px-4 py-3 text-gray-900 max-w-xs truncate">
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
                    <ReviewReasons reasons={tx.reviewReasons} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId !== tx.id && (
                      <div className="flex justify-end gap-2">
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

        {/* Pagination */}
        {txResponse && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <span className="text-xs text-gray-500">
              Showing {transactions.length} transactions
            </span>
            <div className="flex gap-2">
              {cursor && (
                <button
                  onClick={() => setCursor(undefined)}
                  className="text-sm px-3 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                >
                  ← First Page
                </button>
              )}
              {txResponse.hasMore && txResponse.nextCursor && (
                <button
                  onClick={() => setCursor(txResponse.nextCursor!)}
                  className="text-sm px-3 py-1 rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchRules,
  fetchCategories,
  createRule,
  updateRule,
  deleteRule,
  applyAllRules,
  type Rule,
  type Category,
} from "../lib/api";

const CONDITION_TYPES = [
  { value: "description_contains", label: "Description contains" },
  { value: "description_equals", label: "Description equals" },
  { value: "amount_gt", label: "Amount greater than ($)" },
  { value: "amount_lt", label: "Amount less than ($)" },
  { value: "amount_eq", label: "Amount equals ($)" },
];

const ACTION_TYPES = [
  { value: "set_category", label: "Set category to" },
  { value: "add_flag", label: "Add flag" },
];

const AVAILABLE_FLAGS = [
  "high_value",
  "low_value",
  "needs_attention",
  "suspicious",
];

export default function Rules() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ["rules"],
    queryFn: fetchRules,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });

  const createMutation = useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] });
      setShowAdd(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      updateRule(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });

  const applyMutation = useMutation({
    mutationFn: applyAllRules,
    onSuccess: (data) => {
      alert(`Rules applied to ${data.updated} transactions.`);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Rules</h2>
        <div className="flex gap-2">
          <button
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {applyMutation.isPending ? "Running…" : "Re-run All Rules"}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            + Add Rule
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">New Rule</h3>
          <RuleForm
            categories={categories}
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowAdd(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            No rules yet. Create one to start auto-categorizing transactions.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-white rounded-xl border p-4 flex items-center justify-between transition-opacity ${
                rule.active
                  ? "border-gray-200"
                  : "border-gray-100 opacity-60"
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-900 text-sm">
                    {rule.name}
                  </span>
                  <span className="text-xs text-gray-400">
                    Priority: {rule.priority}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  If{" "}
                  <span className="font-medium text-gray-800">
                    {CONDITION_TYPES.find(
                      (c) => c.value === rule.conditionType
                    )?.label || rule.conditionType}
                  </span>{" "}
                  <span className="text-indigo-600 font-mono">
                    "{rule.conditionValue}"
                  </span>{" "}
                  → {" "}
                  <span className="font-medium text-gray-800">
                    {ACTION_TYPES.find((a) => a.value === rule.actionType)
                      ?.label || rule.actionType}
                  </span>{" "}
                  <span className="text-indigo-600 font-mono">
                    "{rule.actionValue}"
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() =>
                    toggleMutation.mutate({
                      id: rule.id,
                      active: !rule.active,
                    })
                  }
                  className={`text-xs px-3 py-1 rounded-lg font-medium ${
                    rule.active
                      ? "bg-green-50 text-green-700 hover:bg-green-100"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {rule.active ? "Active" : "Disabled"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Delete this rule?"))
                      deleteMutation.mutate(rule.id);
                  }}
                  className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule Form
// ---------------------------------------------------------------------------
function RuleForm({
  categories,
  onSubmit,
  onCancel,
  loading,
}: {
  categories: Category[];
  onSubmit: (data: Record<string, any>) => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const [name, setName] = useState("");
  const [conditionType, setConditionType] = useState("description_contains");
  const [conditionValue, setConditionValue] = useState("");
  const [actionType, setActionType] = useState("set_category");
  const [actionValue, setActionValue] = useState("");
  const [priority, setPriority] = useState("0");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      conditionType,
      conditionValue,
      actionType,
      actionValue,
      priority: Number(priority),
    });
  }

  const inputClass =
    "block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Rule Name
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='e.g. "Amazon → Shopping"'
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            If…
          </label>
          <select
            value={conditionType}
            onChange={(e) => setConditionType(e.target.value)}
            className={inputClass}
          >
            {CONDITION_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Value
          </label>
          <input
            required
            value={conditionValue}
            onChange={(e) => setConditionValue(e.target.value)}
            placeholder={
              conditionType.startsWith("amount") ? "1000" : "Amazon"
            }
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Then…
          </label>
          <select
            value={actionType}
            onChange={(e) => {
              setActionType(e.target.value);
              setActionValue("");
            }}
            className={inputClass}
          >
            {ACTION_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {actionType === "set_category" ? "Category" : "Flag"}
          </label>
          {actionType === "set_category" ? (
            <select
              value={actionValue}
              onChange={(e) => setActionValue(e.target.value)}
              required
              className={inputClass}
            >
              <option value="">Select category…</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={actionValue}
              onChange={(e) => setActionValue(e.target.value)}
              required
              className={inputClass}
            >
              <option value="">Select flag…</option>
              {AVAILABLE_FLAGS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="w-32">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Priority
        </label>
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create Rule"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

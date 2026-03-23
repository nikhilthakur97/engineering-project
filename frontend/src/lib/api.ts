import axios from "axios";

const api = axios.create({ baseURL: "/api" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface Transaction {
  id: number;
  date: string;
  description: string | null;
  amount: number;
  amountCents: number;
  categoryId: number | null;
  category: Category | null;
  categorySource: "manual" | "import" | "rule";
  anomalyFlags: string[];
  reviewReasons: string[];
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionListResponse {
  data: Transaction[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface Rule {
  id: number;
  name: string;
  conditionType: string;
  conditionValue: string;
  actionType: string;
  actionValue: string;
  priority: number;
  active: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  total: number;
  uncategorized: number;
  flagged: number;
  needsReview: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export interface TransactionPayload {
  date: string;
  description: string | null;
  amount: number;
  categoryId: number | null;
}

export interface RulePayload {
  name: string;
  conditionType: string;
  conditionValue: string;
  actionType: string;
  actionValue: string;
  priority: number;
}

export interface SpendingRow {
  month: string;
  [category: string]: string | number;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export async function fetchTransactions(
  params: Record<string, string | number | boolean | null | undefined> = {}
): Promise<TransactionListResponse> {
  const { data } = await api.get("/transactions", { params });
  return data;
}

export async function createTransaction(
  body: TransactionPayload
): Promise<Transaction> {
  const { data } = await api.post("/transactions", body);
  return data;
}

export async function updateTransaction(
  id: number,
  body: Partial<TransactionPayload> & {
    needsReview?: boolean;
    anomalyFlags?: string[];
  }
): Promise<Transaction> {
  const { data } = await api.put(`/transactions/${id}`, body);
  return data;
}

export async function deleteTransaction(id: number): Promise<void> {
  await api.delete(`/transactions/${id}`);
}

export async function bulkAction(body: {
  ids: number[];
  action: string;
  categoryId?: number;
}): Promise<{ updated?: number; deleted?: number }> {
  const { data } = await api.patch("/transactions/bulk", body);
  return data;
}

export interface ImportProgress {
  phase: string;
  totalRows: number;
  processedRows: number;
  imported: number;
  skipped: number;
  failed: number;
}

export async function fetchImportProgress(): Promise<ImportProgress> {
  const { data } = await api.get("/transactions/import/progress");
  return data;
}

export async function importCsv(file: File): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/transactions/import", form, {
    timeout: 600_000,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function fetchCategories(): Promise<Category[]> {
  const { data } = await api.get("/categories");
  return data;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
export async function fetchRules(): Promise<Rule[]> {
  const { data } = await api.get("/rules");
  return data;
}

export async function createRule(body: RulePayload): Promise<Rule> {
  const { data } = await api.post("/rules", body);
  return data;
}

export async function updateRule(
  id: number,
  body: Partial<RulePayload> & { active?: boolean }
): Promise<Rule> {
  const { data } = await api.put(`/rules/${id}`, body);
  return data;
}

export async function deleteRule(id: number): Promise<void> {
  await api.delete(`/rules/${id}`);
}

export async function applyAllRules(): Promise<{ updated: number }> {
  const { data } = await api.post("/rules/apply");
  return data;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await api.get("/dashboard/summary");
  return data;
}

export interface SpendingData {
  data: SpendingRow[];
  categories: string[];
}

export async function fetchSpending(months = 12): Promise<SpendingData> {
  const { data } = await api.get("/dashboard/spending", {
    params: { months },
  });
  return data;
}

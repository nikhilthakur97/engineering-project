import test from "node:test";
import assert from "node:assert/strict";
import { validateRow } from "./csvImporter";

test("validateRow derives amount from deposits and withdrawals", () => {
  const row: {
    date: string;
    description: string;
    deposits: string;
    withdrawals: string;
    amount?: string;
  } = {
    date: "2026-03-22",
    description: "Payroll",
    deposits: "1200.00",
    withdrawals: "0.00",
  };

  const result = validateRow(row, 2);

  assert.equal(result.error, undefined);
  assert.equal(row.amount, "1200");
});

test("validateRow rejects malformed amounts", () => {
  const row = {
    date: "2026-03-22",
    description: "Store",
    amount: "$12x",
  };

  const result = validateRow(row, 2);

  assert.equal(result.error, 'Invalid amount: "$12x"');
});

test("validateRow rejects missing dates", () => {
  const row = {
    description: "Store",
    amount: "12.00",
  };

  const result = validateRow(row, 2);

  assert.equal(result.error, "Missing date");
});

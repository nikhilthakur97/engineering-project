import { useState, useRef, useEffect } from "react";
import axios from "axios";
import {
  importCsv,
  fetchImportProgress,
  type ImportResult,
  type ImportProgress,
} from "../lib/api";

interface Props {
  onComplete: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  validating: "Validating & applying rules",
  deduplicating: "Checking for duplicates",
  inserting: "Inserting transactions",
  detecting_anomalies: "Running anomaly detection",
  complete: "Complete",
  idle: "Idle",
};

export default function CsvUpload({ onComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uploading) return;

    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    const poller = setInterval(async () => {
      try {
        const p = await fetchImportProgress();
        if (p.phase !== "idle") setProgress(p);
      } catch {
        // Keep polling quietly; import progress is best-effort UI state.
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      clearInterval(poller);
    };
  }, [uploading]);

  async function handleFile(file: File) {
    setUploading(true);
    setResult(null);
    setElapsed(0);
    setProgress(null);
    try {
      const res = await importCsv(file);
      setResult(res);
      onComplete();
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error || err.message
        : err instanceof Error
          ? err.message
          : "Upload failed";
      setResult({
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [
          { row: 0, message },
        ],
      });
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith(".csv")) {
      handleFile(file);
    } else if (file) {
      setResult({ imported: 0, skipped: 0, failed: 0, errors: [{ row: 0, message: "Please upload a .csv file" }] });
    }
  }

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Weight each phase so the bar reflects the full pipeline, not just validation
  const pct = (() => {
    if (!progress || progress.totalRows === 0) return 0;
    const rowPct = progress.processedRows / progress.totalRows;
    switch (progress.phase) {
      case "validating":
        return Math.round(rowPct * 40);
      case "deduplicating":
        return 40 + Math.round(10);
      case "inserting":
        return 50 + Math.round(
          (progress.imported / Math.max(progress.totalRows - progress.failed - progress.skipped, 1)) * 30
        );
      case "detecting_anomalies":
        return 85;
      case "complete":
        return 100;
      default:
        return 0;
    }
  })();

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          uploading
            ? "border-indigo-300 bg-indigo-50 cursor-wait"
            : dragging
              ? "border-indigo-400 bg-indigo-50 cursor-pointer"
              : "border-gray-300 hover:border-gray-400 cursor-pointer"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="animate-spin h-4 w-4 text-indigo-600"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <p className="text-sm font-medium text-indigo-700">
                {progress
                  ? PHASE_LABELS[progress.phase] || progress.phase
                  : "Uploading…"}
              </p>
            </div>

            {progress && progress.totalRows > 0 && (
              <div className="max-w-md mx-auto">
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                  <span>
                    {progress.processedRows.toLocaleString()} /{" "}
                    {progress.totalRows.toLocaleString()} rows ({pct}%)
                  </span>
                  <span>Elapsed: {timeStr}</span>
                </div>
                <div className="flex gap-4 justify-center mt-1.5 text-xs">
                  <span className="text-green-600">
                    {progress.imported.toLocaleString()} inserted
                  </span>
                  <span className="text-yellow-600">
                    {progress.skipped.toLocaleString()} skipped
                  </span>
                  <span className="text-red-600">
                    {progress.failed.toLocaleString()} failed
                  </span>
                </div>
              </div>
            )}

            {!progress && (
              <p className="text-xs text-gray-500">Elapsed: {timeStr}</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 font-medium">
              Drop a CSV file here or click to browse
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Expected columns: date, description, amount, category
            </p>
          </>
        )}
      </div>

      {result && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <div className="flex gap-6 mb-2">
            <span className="text-green-700 font-medium">
              {result.imported} imported
            </span>
            <span className="text-yellow-700 font-medium">
              {result.skipped} skipped
            </span>
            <span className="text-red-700 font-medium">
              {result.failed} failed
            </span>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-40 overflow-auto">
              {result.errors.map((e, i) => (
                <li key={i} className="text-xs text-gray-600">
                  {e.row > 0 && (
                    <span className="text-gray-400">Row {e.row}: </span>
                  )}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

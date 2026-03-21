import { useState, useRef } from "react";
import { importCsv, type ImportResult } from "../lib/api";

interface Props {
  onComplete: () => void;
}

export default function CsvUpload({ onComplete }: Props) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setResult(null);
    try {
      const res = await importCsv(file);
      setResult(res);
      onComplete();
    } catch (err: any) {
      setResult({
        imported: 0,
        skipped: 0,
        failed: 0,
        errors: [{ row: 0, message: err.response?.data?.error || err.message }],
      });
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-300 hover:border-gray-400"
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
          }}
        />
        {uploading ? (
          <p className="text-sm text-gray-500">Uploading & processing…</p>
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

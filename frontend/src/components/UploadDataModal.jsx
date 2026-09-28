// src/components/UploadDataModal.jsx
import { useRef, useState } from "react";
import { X, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  normalizeImportedRow,
  validateImportedRow,
  REQUIRED_IMPORT_COLUMNS,
} from "../utils/projectUtils";
import { uploadDataViaApi } from "../utils/apiClient";

/** Minimal RFC4180-ish CSV parser: handles quoted fields and commas within quotes. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmptyRows.length === 0) return [];

  const headers = nonEmptyRows[0].map((h) => h.trim());
  return nonEmptyRows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

export default function UploadDataModal({ onClose, onImport, backendOnline }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [error, setError] = useState("");
  const [currentFile, setCurrentFile] = useState(null);

  // Real backend import state (Priority 1 — Real Import Pipeline). The
  // client-side parsedRows above are ONLY a preview shown before the file
  // is sent; the numbers that actually count — imported/rejected/duplicate
  // — come back from POST /api/upload and are stored here.
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");

  const handleFile = (file) => {
    setError("");
    setImportError("");
    setImportResult(null);
    setFileName(file.name);
    setCurrentFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let rawRows = [];

        if (file.name.toLowerCase().endsWith(".json")) {
          const json = JSON.parse(text);
          rawRows = Array.isArray(json) ? json : json.projects || [];
        } else {
          rawRows = parseCSV(text);
        }

        if (rawRows.length === 0) {
          setError("No data rows found in the file.");
          setParsedRows([]);
          return;
        }

        const normalized = rawRows.map((r) => ({
          ...normalizeImportedRow(r),
          _validation: validateImportedRow(normalizeImportedRow(r)),
        }));

        setParsedRows(normalized);
      } catch (err) {
        setError(`Could not parse file: ${err.message}`);
        setParsedRows([]);
      }
    };
    reader.readAsText(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const validCount = parsedRows.filter((r) => r._validation.valid).length;
  const invalidCount = parsedRows.length - validCount;

  // Real import flow: send the actual file to the backend, wait for it to
  // validate/normalize/store the rows in SQLite, then show exactly what it
  // reports back and refresh the dashboard from that authoritative result.
  // Nothing here is calculated client-side and presented as "imported".
  const handleImport = async () => {
    if (!backendOnline || !currentFile) return;
    setImporting(true);
    setImportError("");
    try {
      const result = await uploadDataViaApi(currentFile);
      setImportResult(result);
      // Tell the dashboard to re-fetch from the backend so it reflects
      // exactly what was actually stored, not this modal's local guess.
      await onImport();
    } catch (err) {
      setImportError(err?.message || "Could not import the file. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Data Import</span>
            <h2 className="modal__title">Upload MPLADS Data</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal__body">
          {importResult ? (
            // Real result from POST /api/upload — every number here is
            // exactly what the backend validated, stored (or rejected) in
            // SQLite, not a client-side guess.
            <div className="upload-preview">
              <h3 className="pm-section__title">Import Summary</h3>
              <div className="upload-file-summary">
                <div className="upload-file-summary__item">
                  <span>{importResult.records_received} record(s) received</span>
                </div>
                <div className="upload-file-summary__item upload-file-summary__item--ok">
                  <CheckCircle2 size={15} />
                  <span>{importResult.records_imported} imported</span>
                </div>
                {importResult.records_rejected > 0 && (
                  <div className="upload-file-summary__item upload-file-summary__item--warn">
                    <AlertTriangle size={15} />
                    <span>{importResult.records_rejected} rejected</span>
                  </div>
                )}
                {importResult.duplicate_records > 0 && (
                  <div className="upload-file-summary__item upload-file-summary__item--warn">
                    <AlertTriangle size={15} />
                    <span>{importResult.duplicate_records} duplicate</span>
                  </div>
                )}
              </div>

              {importResult.rejected_details?.length > 0 && (
                <div className="upload-preview__scroll" style={{ marginTop: 12 }}>
                  <p className="form-note">Rejection reasons</p>
                  <table className="project-table project-table--preview">
                    <thead>
                      <tr>
                        <th>Work Name</th>
                        <th>Reason(s)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.rejected_details.slice(0, 8).map((r, idx) => (
                        <tr key={idx}>
                          <td>{r.row?.workName || r.row?.["Work Name"] || "—"}</td>
                          <td>{(r.errors || []).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importResult.rejected_details.length > 8 && (
                    <p className="upload-preview__more">
                      + {importResult.rejected_details.length - 8} more rejected row(s) not shown
                    </p>
                  )}
                </div>
              )}

              {importResult.duplicate_details?.length > 0 && (
                <div className="upload-preview__scroll" style={{ marginTop: 12 }}>
                  <p className="form-note">Duplicate reasons</p>
                  <table className="project-table project-table--preview">
                    <thead>
                      <tr>
                        <th>Work Name</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.duplicate_details.slice(0, 8).map((r, idx) => (
                        <tr key={idx}>
                          <td>{r.row?.workName || r.row?.["Work Name"] || "—"}</td>
                          <td>{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importResult.duplicate_details.length > 8 && (
                    <p className="upload-preview__more">
                      + {importResult.duplicate_details.length - 8} more duplicate row(s) not shown
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="upload-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud size={26} strokeWidth={1.5} />
                <p>
                  <strong>Click to browse</strong> or drag & drop a CSV / JSON file
                </p>
                <span className="upload-dropzone__hint">
                  Required columns: {REQUIRED_IMPORT_COLUMNS.join(", ")}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  hidden
                  onChange={handleInputChange}
                />
              </div>

              {!backendOnline && (
                <div className="upload-error">
                  Backend is unreachable. Start the API server to import data — nothing can be
                  stored without it.
                </div>
              )}

              {fileName && (
                <div className="upload-file-summary">
                  <div className="upload-file-summary__item">
                    <FileSpreadsheet size={16} />
                    <span>{fileName}</span>
                  </div>
                  {parsedRows.length > 0 && (
                    <>
                      <div className="upload-file-summary__item">
                        <span>{parsedRows.length} record(s) found</span>
                      </div>
                      <div className="upload-file-summary__item upload-file-summary__item--ok">
                        <CheckCircle2 size={15} />
                        <span>{validCount} look valid</span>
                      </div>
                      {invalidCount > 0 && (
                        <div className="upload-file-summary__item upload-file-summary__item--warn">
                          <AlertTriangle size={15} />
                          <span>{invalidCount} look invalid</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {error && <div className="upload-error">{error}</div>}
              {importError && <div className="upload-error">{importError}</div>}

              {parsedRows.length > 0 && (
                <div className="upload-preview">
                  <h3 className="pm-section__title">Preview</h3>
                  <p className="form-note">
                    This is a quick local preview only — the final imported/rejected/duplicate
                    counts come from the server after you click Import.
                  </p>
                  <div className="upload-preview__scroll">
                    <table className="project-table project-table--preview">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Work Name</th>
                          <th>State</th>
                          <th>District</th>
                          <th>Sanctioned</th>
                          <th>Expenditure</th>
                          <th>Physical %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 8).map((r, idx) => (
                          <tr key={idx}>
                            <td>
                              {r._validation.valid ? (
                                <span className="upload-row-status upload-row-status--ok">Valid</span>
                              ) : (
                                <span
                                  className="upload-row-status upload-row-status--bad"
                                  title={r._validation.errors.join(", ")}
                                >
                                  Invalid
                                </span>
                              )}
                            </td>
                            <td>{r.workName}</td>
                            <td>{r.state}</td>
                            <td>{r.district}</td>
                            <td>₹{Number(r.sanctionedAmount).toLocaleString("en-IN")}</td>
                            <td>₹{Number(r.expenditure).toLocaleString("en-IN")}</td>
                            <td>{r.physicalProgress}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsedRows.length > 8 && (
                    <p className="upload-preview__more">+ {parsedRows.length - 8} more row(s) not shown</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal__footer">
          {importResult ? (
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!backendOnline || !currentFile || parsedRows.length === 0 || importing}
                onClick={handleImport}
              >
                <UploadCloud size={15} />
                {importing ? "Importing…" : "Import to Server"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

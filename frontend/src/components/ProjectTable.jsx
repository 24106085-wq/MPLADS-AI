// src/components/ProjectTable.jsx
import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Eye, SlidersHorizontal } from "lucide-react";
import RiskBadge from "./RiskBadge";
import EmptyState from "./EmptyState";
import { formatCurrencyCompact } from "../utils/projectUtils";
import { getRiskColor } from "../utils/riskCalculator";

const STATUS_OPTIONS = ["All Status", "In Progress", "Completed", "Delayed", "Not Started"];
const RISK_OPTIONS = ["All Risk", "Low", "Moderate", "Medium", "High", "Critical"];
const PAGE_SIZES = [5, 10, 25, 50];

const COLUMNS = [
  { key: "id", label: "Project ID", sortable: true },
  { key: "workName", label: "Work Name", sortable: true },
  { key: "mpName", label: "MP / Constituency", sortable: false },
  { key: "district", label: "Location", sortable: true },
  { key: "expenditure", label: "Financials", sortable: true },
  { key: "physicalProgress", label: "Progress", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "riskScore", label: "Risk", sortable: true },
  { key: "action", label: "Action", sortable: false },
];

function ProgressBar({ value, tone = "default" }) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="mini-progress">
      <div
        className={`mini-progress__fill mini-progress__fill--${tone}`}
        style={{ width: `${clamped}%` }}
      />
      <span className="mini-progress__label">{clamped}%</span>
    </div>
  );
}

export default function ProjectTable({ projects, searchTerm = "", onView }) {
  const [localSearch, setLocalSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [riskFilter, setRiskFilter] = useState("All Risk");
  const [sortKey, setSortKey] = useState("riskScore");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const effectiveSearch = (searchTerm || localSearch).trim().toLowerCase();

  const filtered = useMemo(() => {
    let rows = [...projects];

    if (effectiveSearch) {
      rows = rows.filter((p) =>
        [p.id, p.workName, p.mpName, p.constituency, p.state, p.district]
          .join(" ")
          .toLowerCase()
          .includes(effectiveSearch)
      );
    }

    if (statusFilter !== "All Status") {
      rows = rows.filter((p) => p.status === statusFilter);
    }

    if (riskFilter !== "All Risk") {
      rows = rows.filter((p) => p.riskLevel === riskFilter);
    }

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [projects, effectiveSearch, statusFilter, riskFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortIcon = ({ colKey }) => {
    if (sortKey !== colKey) return <ArrowUpDown size={12} className="th-sort-icon" />;
    return sortDir === "asc" ? (
      <ArrowUp size={12} className="th-sort-icon th-sort-icon--active" />
    ) : (
      <ArrowDown size={12} className="th-sort-icon th-sort-icon--active" />
    );
  };

  return (
    <div className="project-table-wrap">
      <div className="project-table__toolbar">
        <div className="project-table__filters">
          {!searchTerm && (
            <input
              className="project-table__search"
              type="text"
              placeholder="Search by ID, work, MP, district..."
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setPage(1);
              }}
            />
          )}
          <div className="project-table__select-group">
            <SlidersHorizontal size={14} />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={riskFilter}
              onChange={(e) => {
                setRiskFilter(e.target.value);
                setPage(1);
              }}
            >
              {RISK_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="project-table__count">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""} found
        </div>
      </div>

      <div className="project-table__scroll">
        <table className="project-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.sortable ? "th-sortable" : ""}
                  onClick={() => col.sortable && toggleSort(col.key)}
                >
                  <span className="th-content">
                    {col.label}
                    {col.sortable && <SortIcon colKey={col.key} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((p) => (
              <tr key={p.id}>
                <td className="td-mono" data-label="Project ID">
                  {p.id}
                </td>
                <td className="td-work-name" data-label="Work Name" title={p.workName}>
                  {p.workName}
                </td>
                <td data-label="MP / Constituency">
                  <div className="td-mp">
                    <span>{p.mpName}</span>
                    <span className="td-mp__sub">{p.constituency}</span>
                  </div>
                </td>
                <td data-label="Location">
                  <div className="td-stacked">
                    <span className="td-stacked__primary">{p.district}</span>
                    <span className="td-stacked__secondary">{p.state}</span>
                  </div>
                </td>
                <td data-label="Financials">
                  <div className="td-stacked">
                    <span className="td-stacked__primary">
                      {formatCurrencyCompact(p.expenditure)}
                    </span>
                    <span className="td-stacked__secondary">
                      of {formatCurrencyCompact(p.sanctionedAmount)}
                    </span>
                  </div>
                </td>
                <td data-label="Progress">
                  <div className="td-progress-pair">
                    <ProgressBar
                      value={p.financialProgress}
                      tone={p.financialProgress > 100 ? "danger" : "default"}
                    />
                    <ProgressBar value={p.physicalProgress} tone="physical" />
                  </div>
                </td>
                <td data-label="Status">
                  <span className={`status-pill status-pill--${p.status.replace(/\s+/g, "-").toLowerCase()}`}>
                    {p.status}
                  </span>
                </td>
                <td data-label="Risk">
                  <div className="td-risk-combined">
                    <div className="td-risk-score">
                      <span
                        className="td-risk-score__bar"
                        style={{
                          background: `conic-gradient(${getRiskColor(p.riskLevel)} ${
                            p.riskScore * 3.6
                          }deg, #E7EBF0 0deg)`,
                        }}
                      >
                        <span className="td-risk-score__value">{p.riskScore}</span>
                      </span>
                    </div>
                    <RiskBadge level={p.riskLevel} score={p.riskScore} />
                  </div>
                </td>
                <td data-label="Action">
                  <button className="btn-view" onClick={() => onView(p)}>
                    <Eye size={14} />
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <EmptyState
            title="No matching projects"
            message="Try adjusting your search term or filters to find what you're looking for."
          />
        )}
      </div>

      {filtered.length > 0 && (
        <div className="project-table__pagination">
          <div className="pagination__pagesize">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="pagination__controls">
            <button disabled={currentPage === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="pagination__status">
              Page {currentPage} of {totalPages}
            </span>
            <button disabled={currentPage === totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

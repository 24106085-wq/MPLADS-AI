// src/pages/ProjectMap.jsx
//
// PROJECT MAP — Priority 6 / Task 2 (real interactive map).
//
// Real, tile-based interactive map using Leaflet + react-leaflet (OpenStreetMap
// tiles — free, no API key). Zoom, pan and a "reset to India" home control are
// all genuine map interactions, not a hand-rolled SVG projection.
//
// REAL DATA MODE — unchanged from the previous build:
// Every marker's risk score/level/factors comes straight from
// GET /api/geo/projects (backend/geo.py + monitoring.py) — this page never
// recalculates risk and never fabricates a coordinate. A project with no
// latitude/longitude on file (locationUnavailable: true) is never plotted;
// it is only ever counted in "Unmapped".

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Layers, RefreshCcw, ShieldAlert, Search, Home, Globe2 } from "lucide-react";
import { fetchGeoProjectsFromApi } from "../utils/apiClient";
import { formatCurrency } from "../utils/projectUtils";
import { getRiskColor } from "../utils/riskCalculator";
import RiskBadge from "../components/RiskBadge";
import StatCard from "../components/StatCard";
import InvestigationModal from "../components/InvestigationModal";
import EmptyState from "../components/EmptyState";
import "../style/map.css";

// Default view: centered on India. Users can zoom/scroll out to the world
// view from here (min/max zoom below keeps the whole globe reachable).
const INDIA_CENTER = [22.9734, 78.6569];
const INDIA_ZOOM = 5;
const MIN_ZOOM = 2; // world view
const MAX_ZOOM = 18;

const RISK_FILTERS = ["All", "Critical", "High", "Medium", "Moderate", "Low"];

// Mounted once inside <MapContainer> so we can hand the live Leaflet map
// instance back up to the page (for the Home/reset control) without
// reaching for any global/window state.
function MapInstanceBridge({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

export default function ProjectMap() {
  const [markers, setMarkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [investigationProject, setInvestigationProject] = useState(null);
  const [riskFilter, setRiskFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [mapInstance, setMapInstance] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    fetchGeoProjectsFromApi()
      .then((data) => {
        setMarkers(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not reach the backend map endpoint (GET /api/geo/projects).");
        setLoading(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  // Only markers with real coordinates are plottable — a project with
  // locationUnavailable: true (no lat/lon on file) is never given a fake
  // point, so it's excluded here rather than plotted at NaN/0,0.
  const mappable = useMemo(
    () => markers.filter((m) => m.latitude != null && m.longitude != null && !m.locationUnavailable),
    [markers]
  );
  const unmappedCount = markers.length - mappable.length;

  const filtered = useMemo(() => {
    return mappable.filter((m) => {
      if (riskFilter !== "All" && m.riskLevel !== riskFilter) return false;
      if (
        searchTerm &&
        !`${m.workName} ${m.id} ${m.district} ${m.state}`.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [mappable, riskFilter, searchTerm]);

  // Risk-level counts, computed from the full backend dataset (all imported
  // projects, mapped or not) — used for both the filter chip badges and the
  // summary row below. Never a locally-invented value.
  const riskCounts = useMemo(() => {
    const c = { Critical: 0, High: 0, Medium: 0, Moderate: 0, Low: 0 };
    markers.forEach((m) => {
      if (c[m.riskLevel] !== undefined) c[m.riskLevel] += 1;
    });
    return c;
  }, [markers]);

  const hasData = markers.length > 0;

  return (
    <div className="map-page">
      <div className="map-page__header">
        <div>
          <h1 className="dashboard__title">Project Map</h1>
          <p className="dashboard__subtitle">
            Geo-distribution of sanctioned MPLADS works, colored by backend-computed risk level.
          </p>
        </div>
        <button className="btn-secondary" onClick={load}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </div>

      {loading && <p className="pm-empty-note">Loading project locations…</p>}

      {error && !loading && <EmptyState icon={ShieldAlert} title="Map unavailable" message={error} />}

      {!loading && !error && !hasData && (
        <EmptyState
          icon={MapPin}
          title="No project data imported"
          message="Import an MPLADS dataset to activate geographic monitoring."
        />
      )}

      {!loading && !error && hasData && (
        <>
          {/* Task 7 — dynamic map summary, entirely from backend/imported data. */}
          <div className="map-summary-grid">
            <StatCard icon={Globe2} value={markers.length} label="Total Projects" tone="default" />
            <StatCard icon={MapPin} value={mappable.length} label="Mapped" tone="good" />
            <StatCard icon={MapPin} value={unmappedCount} label="Unmapped" tone="warn" />
            <StatCard value={riskCounts.Critical} label="Critical" tone="bad" />
            <StatCard value={riskCounts.High} label="High" tone="bad" />
            <StatCard value={riskCounts.Medium} label="Medium" tone="warn" />
            <StatCard value={riskCounts.Moderate} label="Moderate" tone="default" />
            <StatCard value={riskCounts.Low} label="Low" tone="good" />
          </div>

          <div className="pm-disclaimer" style={{ marginBottom: 14 }}>
            <MapPin size={13} />
            <span>
              Only projects with real latitude/longitude on file are plotted (MAPPED — GPS coordinates
              available).
              {unmappedCount > 0
                ? ` ${unmappedCount} project${unmappedCount === 1 ? "" : "s"} have no recorded location (UNMAPPED — GPS coordinates unavailable) and are never given a fake position.`
                : ""}
            </span>
          </div>

          <div className="map-toolbar">
            <div className="map-toolbar__search">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search project ID, name, district or state…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="map-toolbar__filters">
              {RISK_FILTERS.map((r) => (
                <button
                  key={r}
                  className={`map-chip ${riskFilter === r ? "map-chip--active" : ""}`}
                  style={r !== "All" ? { borderColor: `${getRiskColor(r)}55`, color: getRiskColor(r) } : undefined}
                  onClick={() => setRiskFilter(r)}
                >
                  {r}
                  {r !== "All" && riskCounts[r] !== undefined ? ` (${riskCounts[r]})` : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="map-canvas-wrap">
            <div className="map-canvas map-canvas--leaflet">
              <MapContainer
                center={INDIA_CENTER}
                zoom={INDIA_ZOOM}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                worldCopyJump
                style={{ width: "100%", height: "100%" }}
              >
                <MapInstanceBridge onReady={setMapInstance} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {filtered.map((m) => (
                  <CircleMarker
                    key={m.id}
                    center={[m.latitude, m.longitude]}
                    radius={selected?.id === m.id ? 10 : 7}
                    pathOptions={{
                      color: "#fff",
                      weight: 1.5,
                      fillColor: getRiskColor(m.riskLevel || "Low"),
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{ click: () => setSelected(m) }}
                  />
                ))}
              </MapContainer>

              {/* Home / reset control — required "reset/home control". */}
              <button
                type="button"
                className="map-home-control"
                title="Reset to India view"
                onClick={() => mapInstance?.setView(INDIA_CENTER, INDIA_ZOOM, { animate: true })}
              >
                <Home size={15} />
              </button>

              {filtered.length === 0 && (
                <div className="map-canvas__overlay-note">
                  No mapped projects match the current filter/search.
                </div>
              )}
            </div>

            <div className="map-legend">
              <span className="map-legend__title">
                <Layers size={13} /> Risk Level
              </span>
              {["Critical", "High", "Medium", "Moderate", "Low"].map((lvl) => (
                <span key={lvl} className="map-legend__item">
                  <span className="map-legend__dot" style={{ background: getRiskColor(lvl) }} />
                  {lvl}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {selected && (
        <div className="map-popup-overlay" onClick={() => setSelected(null)}>
          <div className="map-popup" onClick={(e) => e.stopPropagation()}>
            <div className="map-popup__header">
              <span className="modal__eyebrow">{selected.id}</span>
              <h3>{selected.workName}</h3>
              <button className="modal__close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>

            <p className="map-popup__location">
              <MapPin size={13} /> {selected.district}, {selected.state}
              <span className="map-popup__demo-tag">MAPPED — GPS available</span>
            </p>

            <div className="map-popup__risk">
              <RiskBadge level={selected.riskLevel} score={selected.riskScore} showScore />
            </div>

            <div className="pm-grid" style={{ marginTop: 10 }}>
              <div className="pm-card">
                <span className="pm-card__label">Sanctioned Amount</span>
                <span className="pm-card__value">{formatCurrency(selected.sanctionedAmount)}</span>
              </div>
              <div className="pm-card">
                <span className="pm-card__label">Expenditure</span>
                <span className="pm-card__value">{formatCurrency(selected.expenditure)}</span>
              </div>
              <div className="pm-card">
                <span className="pm-card__label">Physical Progress</span>
                <span className="pm-card__value">{selected.physicalProgress ?? 0}%</span>
              </div>
            </div>

            {selected.topRiskFactors?.length > 0 && (
              <div className="pm-factor-list" style={{ marginTop: 10 }}>
                {selected.topRiskFactors.map((f) => (
                  <div className="pm-factor" key={f.name}>
                    <div className="pm-factor__top">
                      <span className="pm-factor__name">{f.name}</span>
                      <span className={`pm-factor__severity pm-factor__severity--${(f.severity || "medium").toLowerCase()}`}>
                        +{f.points} pts
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              className="btn-primary map-popup__cta"
              onClick={() => {
                setInvestigationProject(selected);
                setSelected(null);
              }}
            >
              Investigate
            </button>
          </div>
        </div>
      )}

      {investigationProject && (
        <InvestigationModal project={investigationProject} onClose={() => setInvestigationProject(null)} />
      )}
    </div>
  );
}

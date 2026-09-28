# backend/geo.py
"""
Geo-Spatial helper (Target Architecture Block 1/7: Geo-Spatial Data ->
Project Map).

REAL DATA MODE: this module NEVER fabricates a project's location.

How it works:
- If a project record carries real `latitude`/`longitude` values (e.g. an
  uploaded CSV/JSON with those columns, or a value supplied via
  POST /api/projects), those real values are used as-is.
- If a project has no valid coordinates on file, this module does NOT
  invent one. It reports `locationUnavailable: True` with
  `latitude`/`longitude` set to `None` so the API/UI can honestly show
  "Location unavailable" instead of placing a fake marker on the map.

Earlier prototype versions of this module filled the gap with a
deterministic demo point derived from the project's state centroid. That
fallback has been removed per the Real Data Mode requirement — every
coordinate this module returns now either comes directly from real
imported/entered data, or is absent.
"""


def resolve_coordinates(project: dict) -> dict:
    """Returns {latitude, longitude, locationUnavailable} for a project.
    Uses real coordinates already on the record if present and valid;
    otherwise reports the location as unavailable rather than guessing."""
    lat = project.get("latitude")
    lon = project.get("longitude")
    if lat is not None and lon is not None:
        try:
            return {
                "latitude": float(lat),
                "longitude": float(lon),
                "locationUnavailable": False,
            }
        except (TypeError, ValueError):
            pass

    return {"latitude": None, "longitude": None, "locationUnavailable": True}

# Project Skills & Requirements Document

## 1. Project Overview

**Objective:** Build an interactive web application that maps global ports, mines, and maritime chokepoints, then analyzes sea/routing to identify critical chokepoints in the global supply chain.

**Key Outcome:** A single-page application (SPA) where users can:
- Select origin and destination ports
- Visualize the sea route between them
- Find mines near the selected destination port (within a configurable radius) for a chosen commodity
- See road connections from port to mines
- Inspect chokepoints along the sea route and view mine/chokepoint details

---

## 2. Data Sources & Schemas

### 2.1 Mines — `global-mining-dataset.xlsx`
- **Format:** Excel (.xlsx)
- **Expected columns (to confirm):**
  - `mine_name` / `site_name`
  - `commodity` (e.g., copper, iron ore, coal, lithium, etc.)
  - `latitude`
  - `longitude`
  - `country`
  - `status` (active / inactive / planned)
  - `production_capacity` (optional)
  - `owner_company` (optional)

### 2.2 Chokepoints — `PortWatch_chokepoints_database.csv`
- **Format:** CSV
- **Expected columns (to confirm):**
  - `chokepoint_name`
  - `latitude`
  - `longitude`
  - `region`
  - `description`
  - `strategic_importance`
  - `traffic_volume` (optional)

### 2.3 Ports — `UpdatedPub150.csv`
- **Format:** CSV
- **Expected columns (to confirm):**
  - `port_name`
  - `country`
  - `latitude`
  - `longitude`
  - `UNLOCODE` (optional)
  - `region` (optional)

---

## 3. Technical Architecture

### 3.1 Backend (Python — Single File)

**Framework:** FastAPI + Uvicorn

**Libraries:**
| Library | Purpose |
|---------|---------|
| `pandas` | Data loading & filtering (ports, mines, chokepoints) |
| `searoute` | Maritime route calculation between two port coordinates |
| `fastapi` | REST API framework |
| `uvicorn` | ASGI server |
| `openpyxl` | Read `.xlsx` mine dataset |
| `shapely` / `geopy` | Geo-distance calculations (radius search for mines) |
| `osmnx` or OSRM API | Road routing from port to mines (**optional / preferred**) |

**API Endpoints to implement:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ports` | GET | Return all ports (for dropdown selection) |
| `/api/mines?commodity={c}&lat={lat}&lon={lon}&radius={km}` | GET | Return mines matching commodity within radius of a point |
| `/api/route?origin_port_id={}&dest_port_id={}` | GET | Return sea route (GeoJSON polyline) between two ports |
| `/api/road-route?port_lat={}&port_lon={}&mine_lat={}&mine_lon={}` | GET | Return road route from port to a specific mine |
| `/api/chokepoints?route_geojson={}` | GET | Return chokepoints that intersect or are near the sea route |
| `/api/commodities` | GET | Return distinct list of commodities available in mine dataset |

**Backend Logic Flow:**
1. On startup, load all three datasets into memory (pandas DataFrames).
2. On port selection → fetch port coordinates.
3. Call `searoute` to compute the maritime route between origin and destination ports.
4. Intersect the route line with the chokepoint dataset to flag nearby chokepoints.
5. For mine search: filter mines by commodity, then compute Haversine distance from destination port, return those within the user-specified radius.
6. For road route: use OSRM (or a local routing engine) to get the driving path from destination port to each selected mine.

### 3.2 Frontend (HTML + JS + CSS — component-based)

**Stack:** Plain HTML/CSS/JS (no heavy framework required). Consider Leaflet.js for map rendering.

**Libraries (CDN):**
| Library | Purpose |
|---------|---------|
| `Leaflet.js` | Interactive map display |
| `Leaflet.RoutingMachine` (optional) | For road route overlay |
| Custom JS | Sidebar logic, state management, API calls |

**UI Layout:**

```
┌─────────────────────────────────────────────────────┐
│ Left Sidebar (300px)   │   Map (flex-grow)          │  Right Sidebar (collapsible, 300px)
│                         │                            │
│  ┌─────────────────┐   │                            │  ┌─────────────────┐
│  │ Origin Port      │   │                            │  │ Mine Details     │
│  │ [Dropdown ▼]     │   │        (Interactive        │  │ - Name           │
│  │ Destination Port │   │         Leaflet Map)       │  │ - Commodity      │
│  │ [Dropdown ▼]     │   │                            │  │ - Distance       │
│  ├─────────────────┤   │                            │  │ - Road Route     │
│  │ Commodity        │   │                            │  ├─────────────────┤
│  │ [Dropdown ▼]     │   │                            │  │ Chokepoint       │
│  │ Radius (km)      │   │                            │  │ Details          │
│  │ [Slider: 10-500] │   │                            │  │ - Name           │
│  ├─────────────────┤   │                            │  │ - Description    │
│  │ [Find Mines]     │   │                            │  │ - Strategic Info │
│  └─────────────────┘   │                            │  └─────────────────┘
│                         │                            │
└─────────────────────────────────────────────────────┘
```

**Left Sidebar (always visible):**
- Origin port dropdown (populated from `/api/ports`)
- Destination port dropdown (populated from `/api/ports`)
- Commodity dropdown (populated from `/api/commodities`)
- Radius range slider (min: 10 km, max: 500 km, step: 10 km)
- "Find Mines" / "Calculate Route" button

**Map Panel (center, fills remaining width):**
- Leaflet base map (dark tile layer for dark theme)
- Sea route line (blue/cyan thick polyline)
- Port markers (anchors)
- Mine markers (diamond icons, color-coded by commodity)
- Chokepoint markers (warning/alert icons)
- Road route lines (orange/yellow dashed polylines)

**Right Sidebar (collapsible, toggle button):**
- **Mine Details Section:** Shown when a mine marker is clicked or selected.
  - Mine name, commodity, distance from port
  - "Show Road Route" button
- **Chokepoint Details Section:** Shown when a chokepoint marker is clicked.
  - Chokepoint name, region, description, strategic importance
- Collapse/expand toggle button (hamburger or arrow icon at edge)

### 3.3 Styling Specifications

**Theme:** Dark, Minimal, Sharp (no rounded corners)
- Background: `#121212` or `#1a1a2e`
- Sidebar background: `#1e1e2f`
- Text: `#e0e0e0` (primary), `#a0a0b8` (secondary)
- Accent: `#4a9eff` (blue), `#ff6b35` (orange for roads), `#ffd700` (warning for chokepoints)
- Borders: `1px solid #2a2a3d`
- Border-radius: `0px` (sharp/square)
- Font: `'Inter', 'Segoe UI', sans-serif` (clean, modern)
- Dropdowns: dark background, light text, sharp corners
- Buttons: solid accent color, no border-radius, hover state with brighter shade

**CSS Architecture:**
- Single `styles.css` file
- CSS custom properties (variables) for theme colors
- Flexbox layout for sidebar + map
- Responsive down to 1024px width (desktop-first)
- No Bootstrap — keep it lean

---

## 4. Interactive Flow (User Journey)

### Step 1: Load App
- Backend starts and loads all datasets into memory.
- Frontend loads, fetches port list, populates both dropdowns.
- Map centers on a global view (lat: 20, lon: 0, zoom: 2).

### Step 2: Select Ports
- User selects origin and destination ports from the left sidebar dropdowns.
- On selection (or button click), frontend calls `/api/route`.
- Sea route polyline rendered on the map.
- Chokepoints near the route are fetched and displayed.

### Step 3: Set Commodity & Radius
- User selects a commodity from the dropdown.
- Adjusts radius slider (e.g., 200 km).
- Clicks "Find Mines".
- Frontend calls `/api/mines` with destination port lat/lon, commodity, radius.
- Matching mine markers appear on the map.

### Step 4: Inspect Details
- User clicks a mine marker → right sidebar opens (or updates) with mine details.
- User clicks "Show Road Route" → frontend calls `/api/road-route` → orange polyline appears on map.
- User clicks a chokepoint marker → right sidebar shows chokepoint details.

### Step 5: Collapse/Expand
- Right sidebar can be collapsed by the user to maximize map view.

---

## 5. Data Processing Rules

### Sea Route Calculation
- Use `searoute` library: takes origin (lat, lon) and destination (lat, lon).
- Returns a GeoJSON LineString of the maritime route.
- Parse GeoJSON coordinates and render as a polyline on Leaflet.

### Chokepoint Detection
- After obtaining the sea route geometry, check each chokepoint's proximity to the route.
- Proximity threshold: within ~50 km of any point on the route polyline (configurable).
- Return all matching chokepoints.

### Mine Radius Search
- Use Haversine formula to compute great-circle distance from destination port to each mine.
- Filter: `distance <= radius_km` AND `commodity == selected_commodity`.
- Return filtered list with distances.

### Road Route Calculation
- Option A (recommended first): Use OSRM public API (`https://router.project-osrm.org/route/v1/driving/{port_lon},{port_lat};{mine_lon},{mine_lat}`).
- Option B: Set up a local OSRM instance with a road network extract (heavy, for production).
- Return driving route as GeoJSON.

---

## 6. Performance & Edge Cases

### Performance Considerations
- Datasets are loaded in memory once at server startup (not per request).
- Use caching for expensive route calculations (in-memory dict with LRU).
- Mine search should be fast: pre-index by commodity column with pandas filtering.

### Edge Cases
- **No mines found:** Show a clear message "No mines found for {commodity} within {radius} km of {port}."
- **No chokepoints along route:** Show "No chokepoints detected on this route."
- **Port with missing coordinates:** Skip or flag in logs.
- **searoute cannot compute route** (e.g., landlocked ports): Return error message.
- **OSRM API failure:** Fallback to straight-line visualization with a note.
- **Empty datasets:** Handle gracefully with appropriate error responses.
- **Port selected as both origin & destination:** Show warning, disable route calculation.

---

## 7. File Structure

```
project-root/
├── backend.py                  # Single Python file — all backend logic
├── requirements.txt            # Python dependencies
├── templates/
│   └── index.html             # Main HTML page (single-page app)
├── static/
│   ├── css/
│   │   └── styles.css         # All styles (dark theme, sharp design)
│   └── js/
│       └── app.js             # All frontend logic (map, API calls, UI interactions)
├── data/
│   ├── global-mining-dataset.xlsx
│   ├── PortWatch_chokepoints_database.csv
│   └── UpdatedPub150.csv
├── project.txt                 # Original requirements file
└── project-skills.md           # This document
```

---

## 8. Dependencies (`requirements.txt`)

```
fastapi==0.111.0
uvicorn==0.30.1
pandas==2.2.2
openpyxl==3.1.5
searoute==1.2.0
shapely==2.0.4
geopy==2.4.1
python-multipart==0.0.9
```

*Note: OSRM is used via HTTP API (not a local install), so no Python package is needed for it.*

---

## 9. Development Setup

1. **Clone / navigate** to `project-root/`.
2. **Create virtual environment:**
   ```bash
   python -m venv venv
   venv\Scripts\activate   # Windows
   ```
3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
4. **Run backend:**
   ```bash
   uvicorn backend:app --reload --host 0.0.0.0 --port 8000
   ```
5. **Open browser:** Go to `http://localhost:8000` to see the app.
6. **Ensure data files** are in the `data/` directory.

---

## 10. Future Enhancements (Not in Scope for v1)

- [ ] User authentication / saved routes
- [ ] Download route as GeoJSON / PDF report
- [ ] Historical chokepoint congestion data overlay
- [ ] Mine production statistics charts
- [ ] Alternative route suggestions around chokepoints
- [ ] Real-time ship tracking integration (AIS data)
- [ ] Local OSRM deployment for faster road routing
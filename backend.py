import os
import math
import json
import hashlib
from functools import lru_cache
from typing import Optional, List

import pandas as pd
import uvicorn
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from geopy.distance import geodesic
from shapely.geometry import LineString, Point, shape, mapping
from shapely.ops import nearest_points

app = FastAPI(title="Global Supply Chain Chokepoint Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT_DIR, "data")

def _find_file(filename):
    """Look for file in data/ directory first, then in project root."""
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        return path
    path = os.path.join(ROOT_DIR, filename)
    if os.path.exists(path):
        return path
    return None

def load_data():
    """Load all datasets into global memory at startup."""
    global ports_df, mines_df, chokepoints_df

    # Load ports
    ports_path = os.path.join(DATA_DIR, "UpdatedPub150.csv")
    if os.path.exists(ports_path):
        ports_df = pd.read_csv(ports_path, low_memory=False)
        # Clean column names
        ports_df.columns = ports_df.columns.str.strip()
    else:
        ports_df = pd.DataFrame()

    # Load mines
    mines_path = os.path.join(DATA_DIR, "global-mining-dataset.xlsx")
    if os.path.exists(mines_path):
        xl = pd.ExcelFile(mines_path)
        sheet_names = xl.sheet_names
        # Prefer "External" sheet, then fallback to first non-About sheet
        data_sheet = "External" if "External" in sheet_names else (
            [s for s in sheet_names if s not in ["About", "Metadata"]][0] if any(s not in ["About", "Metadata"] for s in sheet_names) else sheet_names[0]
        )
        mines_df = pd.read_excel(mines_path, sheet_name=data_sheet)
        # Strip column names and rename "Mine Name " (with trailing space) to "Mine Name"
        mines_df.columns = mines_df.columns.str.strip()
        if "Mine Name" in mines_df.columns and "Mine Name " in mines_df.columns:
            pass  # already renamed by strip
    else:
        mines_df = pd.DataFrame()

    # Load chokepoints
    chokepoints_path = os.path.join(DATA_DIR, "PortWatch_chokepoints_database.csv")
    if os.path.exists(chokepoints_path):
        chokepoints_df = pd.read_csv(chokepoints_path)
        chokepoints_df.columns = chokepoints_df.columns.str.strip()
    else:
        chokepoints_df = pd.DataFrame()

    print(f"Loaded {len(ports_df)} ports, {len(mines_df)} mines, {len(chokepoints_df)} chokepoints")

ports_df = pd.DataFrame()
mines_df = pd.DataFrame()
chokepoints_df = pd.DataFrame()

load_data()

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate great-circle distance in km between two points."""
    return geodesic((lat1, lon1), (lat2, lon2)).kilometers

def get_port_by_id(port_id: str):
    """Find a port by its World Port Index Number."""
    try:
        port_id_num = float(port_id)
        match = ports_df[ports_df["World Port Index Number"] == port_id_num]
        if match.empty:
            return None
        row = match.iloc[0]
        return {
            "id": port_id,
            "name": str(row.get("Main Port Name", "")).strip(),
            "country": str(row.get("Country Code", "")).strip(),
            "latitude": float(row.get("Latitude", 0)),
            "longitude": float(row.get("Longitude", 0)),
        }
    except (ValueError, KeyError):
        return None

def get_all_commodities():
    """Get distinct list of commodities from mines dataset."""
    commodities = set()
    if not mines_df.empty:
        if "Primary Commodity" in mines_df.columns:
            commodities.update(mines_df["Primary Commodity"].dropna().str.lower().str.strip().tolist())
    return sorted([c.title() for c in commodities if c])

def point_to_route_distance(lat, lon, route_coords):
    """Calculate minimum distance from a point (lat,lon) to a polyline route in km."""
    point = Point(lon, lat)
    line = LineString(route_coords)
    nearest = nearest_points(line, point)
    # Convert degrees to km (approximate)
    dist_deg = point.distance(nearest[1])
    return dist_deg * 111.32  # rough conversion

route_cache = {}

def get_cached_route(origin_lat, origin_lon, dest_lat, dest_lon):
    """Get sea route with caching."""
    key = f"{origin_lat:.4f},{origin_lon:.4f}-{dest_lat:.4f},{dest_lon:.4f}"
    if key in route_cache:
        return route_cache[key]
    try:
        import searoute
        origin = [origin_lon, origin_lat]
        destination = [dest_lon, dest_lat]
        route = searoute.searoute(origin, destination)
        route_cache[key] = route
        return route
    except Exception as e:
        print(f"Searoute error: {e}")
        return None

@app.get("/api/ports")
def get_ports(search: Optional[str] = Query(None, description="Search term for port name")):
    """Return all ports for dropdown selection."""
    if ports_df.empty:
        return {"ports": []}
    
    result = []
    for _, row in ports_df.iterrows():
        name = str(row.get("Main Port Name", "")).strip()
        if not name or name == "nan":
            continue
        if search and search.lower() not in name.lower():
            continue
        port_id = row.get("World Port Index Number", None)
        if pd.isna(port_id):
            continue
        result.append({
            "id": str(int(port_id)),
            "name": name,
            "country": str(row.get("Country Code", "")).strip(),
            "latitude": float(row.get("Latitude", 0)),
            "longitude": float(row.get("Longitude", 0)),
        })
    
    return {"ports": result}


@app.get("/api/commodities")
def get_commodities():
    """Return distinct list of commodities."""
    return {"commodities": get_all_commodities()}


@app.get("/api/mines")
def get_mines(
    commodity: str = Query(..., description="Commodity/commodities filter (comma-separated for multiple)"),
    lat: float = Query(..., description="Center latitude"),
    lon: float = Query(..., description="Center longitude"),
    radius: float = Query(200, description="Search radius in km"),
):
    """Return mines matching commodity within radius of a point."""
    if mines_df.empty:
        return {"mines": []}
    
    # Support multiple commodities separated by commas
    commodities = [c.strip().lower() for c in commodity.split(",") if c.strip()]
    
    # Build mask for all selected commodities
    mask = pd.Series([False] * len(mines_df))
    for comp in commodities:
        comp_mask = (
            mines_df["Primary Commodity"].fillna("").str.lower().str.strip().str.contains(comp, na=False)
            | mines_df["Secondary Commodity"].fillna("").str.lower().str.strip().str.contains(comp, na=False)
        )
        if "Other Commodities" in mines_df.columns:
            comp_mask |= mines_df["Other Commodities"].fillna("").str.lower().str.strip().str.contains(comp, na=False)
        mask |= comp_mask
    
    filtered = mines_df[mask].copy()
    
    results = []
    for _, row in filtered.iterrows():
        mine_lat = row.get("Latitude", None)
        mine_lon = row.get("Longitude", None)
        if pd.isna(mine_lat) or pd.isna(mine_lon):
            continue
        
        # Handle Unicode minus signs and clean up coordinates
        try:
            mlat = float(str(mine_lat).replace('\u2212', '-').replace('\u2010', '-').replace('\u2011', '-').replace('\u2012', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\u2015', '-').strip())
            mlon = float(str(mine_lon).replace('\u2212', '-').replace('\u2010', '-').replace('\u2011', '-').replace('\u2012', '-').replace('\u2013', '-').replace('\u2014', '-').replace('\u2015', '-').strip())
        except (ValueError, TypeError):
            continue
        
        dist = haversine_distance(lat, lon, mlat, mlon)
        if dist <= radius:
            results.append({
                "id": str(row.get("ICMMID", "")),
                "name": str(row.get("Mine Name", row.get("Mine Name ", ""))).strip(),
                "commodity": str(row.get("Primary Commodity", "")).strip(),
                "latitude": mlat,
                "longitude": mlon,
                "country": str(row.get("Country or Region", "")).strip(),
                "distance_km": round(dist, 2),
                "status": str(row.get("Confidence Factor", "")).strip(),
            })
    
    # Sort by distance
    results.sort(key=lambda x: x["distance_km"])
    
    return {"mines": results}


@app.get("/api/route")
def get_route(
    origin_port_id: str = Query(..., description="Origin port World Port Index Number"),
    dest_port_id: str = Query(..., description="Destination port World Port Index Number"),
):
    """Return sea route GeoJSON between two ports."""
    origin = get_port_by_id(origin_port_id)
    destination = get_port_by_id(dest_port_id)
    
    if not origin:
        raise HTTPException(status_code=404, detail=f"Origin port {origin_port_id} not found")
    if not destination:
        raise HTTPException(status_code=404, detail=f"Destination port {dest_port_id} not found")
    
    if origin_port_id == dest_port_id:
        raise HTTPException(status_code=400, detail="Origin and destination ports must be different")
    
    route_geojson = get_cached_route(
        origin["latitude"], origin["longitude"],
        destination["latitude"], destination["longitude"]
    )
    
    if route_geojson is None:
        # Fallback: return a straight line
        route_geojson = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [origin["longitude"], origin["latitude"]],
                    [destination["longitude"], destination["latitude"]]
                ]
            },
            "properties": {"note": "Straight line approximation (searoute failed)"}
        }
    
    return {
        "route": route_geojson,
        "origin": origin,
        "destination": destination,
    }


@app.get("/api/chokepoints")
def get_chokepoints(
    route_geojson: str = Query(..., description="JSON string of the route GeoJSON"),
    proximity_km: float = Query(50, description="Proximity threshold in km"),
):
    """Return chokepoints near the sea route."""
    if chokepoints_df.empty:
        return {"chokepoints": []}
    
    try:
        route_data = json.loads(route_geojson)
        coords = route_data.get("geometry", {}).get("coordinates", [])
    except:
        return {"chokepoints": []}
    
    results = []
    for _, row in chokepoints_df.iterrows():
        lat = row.get("lat", None)
        lon = row.get("lon", None)
        if pd.isna(lat) or pd.isna(lon):
            continue
        
        chokepoint_name = str(row.get("fullname", row.get("portname", ""))).strip()
        if not chokepoint_name or chokepoint_name == "nan":
            chokepoint_name = str(row.get("portid", "")).strip()
        
        # Calculate min distance to route
        min_dist = float("inf")
        for coord in coords:
            d = haversine_distance(lat, lon, coord[1], coord[0])
            if d < min_dist:
                min_dist = d
        
        if min_dist <= proximity_km:
            results.append({
                "id": str(row.get("portid", "")),
                "name": chokepoint_name,
                "latitude": float(lat),
                "longitude": float(lon),
                "region": str(row.get("country", "")).strip(),
                "description": f"Strategic maritime chokepoint",
                "strategic_importance": f"Vessel traffic: {int(row.get('vessel_count_total', 0)):,}" if pd.notna(row.get("vessel_count_total")) else "Unknown",
                "traffic_volume": str(row.get("vessel_count_total", "")),
                "distance_km": round(min_dist, 2),
            })
    
    # Sort by distance
    results.sort(key=lambda x: x["distance_km"])
    
    return {"chokepoints": results}


@app.get("/api/road-route")
def get_road_route(
    port_lat: float = Query(..., description="Port latitude"),
    port_lon: float = Query(..., description="Port longitude"),
    mine_lat: float = Query(..., description="Mine latitude"),
    mine_lon: float = Query(..., description="Mine longitude"),
):
    """Return road route from port to mine using OSRM."""
    import requests
    
    url = f"https://router.project-osrm.org/route/v1/driving/{port_lon},{port_lat};{mine_lon},{mine_lat}?overview=full&geometries=geojson"
    
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("code") == "Ok" and data.get("routes"):
                route = data["routes"][0]
                geometry = route.get("geometry", {})
                distance_km = route.get("distance", 0) / 1000
                duration_min = route.get("duration", 0) / 60
                
                return {
                    "route": {
                        "type": "Feature",
                        "geometry": geometry,
                        "properties": {
                            "distance_km": round(distance_km, 2),
                            "duration_min": round(duration_min, 1),
                        }
                    }
                }
    except Exception as e:
        print(f"OSRM error: {e}")
    
    # Fallback: straight line
    return {
        "route": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [port_lon, port_lat],
                    [mine_lon, mine_lat]
                ]
            },
            "properties": {
                "distance_km": round(haversine_distance(port_lat, port_lon, mine_lat, mine_lon), 2),
                "duration_min": 0,
                "note": "Straight line (OSRM unavailable)"
            }
        }
    }


@app.get("/api/port-detail")
def get_port_detail(
    port_id: str = Query(..., description="World Port Index Number"),
):
    """Get detailed information about a specific port."""
    port = get_port_by_id(port_id)
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")
    return {"port": port}


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    """Serve the main HTML page."""
    index_path = os.path.join(os.path.dirname(__file__), "templates", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h1>Global Supply Chain Chokepoint Analyzer</h1><p>Frontend not found.</p>")


if __name__ == "__main__":
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)
const state = {
    originPort: null,
    destPort: null,
    routeGeojson: null,
    mines: [],
    chokepoints: [],
    roadRoute: null,
    selectedMine: null,
    allPorts: [],
    renderedMineCount: 0,
    infiniteScrollBatchSize: 10,
    isScrollingLoading: false,
};

const MINE_COLORS = [
    '#ff6b35', '#4a9eff', '#ffd700', '#2ed573', '#ff4757',
    '#a29bfe', '#fd79a8', '#00cec9', '#e17055', '#6c5ce7',
    '#fdcb6e', '#00b894', '#e84393', '#0984e3', '#d63031',
    '#636e72', '#b2bec3', '#55efc4', '#74b9ff', '#81ecec',
];

const map = L.map('map', {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: false,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
}).addTo(map);

map.zoomControl.setPosition('topright');

const routeLayer = L.layerGroup().addTo(map);
const minesLayer = L.layerGroup().addTo(map);
const chokepointsLayer = L.layerGroup().addTo(map);
const roadLayer = L.layerGroup().addTo(map);
const portMarkers = L.layerGroup().addTo(map);

function createDivIcon(className, html = '', size = 14) {
    return L.divIcon({
        className: className,
        html: html,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
        popupAnchor: [0, -size/2],
    });
}

function createMineIcon(color) {
    return L.divIcon({
        className: 'mine-marker-custom',
        html: `<div style="width:12px;height:12px;background:${color};border:2px solid #fff;transform:rotate(45deg);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8],
    });
}

const commodityColors = {};
let colorIndex = 0;

function getCommodityColor(commodity) {
    const key = (commodity || 'unknown').toLowerCase().trim();
    if (!commodityColors[key]) {
        commodityColors[key] = MINE_COLORS[colorIndex % MINE_COLORS.length];
        colorIndex++;
    }
    return commodityColors[key];
}

const originSearch = document.getElementById('origin-search');
const destSearch = document.getElementById('dest-search');
const originSelect = document.getElementById('origin-port');
const destSelect = document.getElementById('dest-port');
const commoditySelect = document.getElementById('commodity-select');
const radiusSlider = document.getElementById('radius-slider');
const radiusValue = document.getElementById('radius-value');
const btnCalculate = document.getElementById('btn-calculate');
const btnFindMines = document.getElementById('btn-find-mines');
const btnClear = document.getElementById('btn-clear');
const statusMsg = document.getElementById('status-message');
const rightSidebar = document.getElementById('right-sidebar');
const mineList = document.getElementById('mine-list');
const mineListLoading = document.getElementById('mine-list-loading');
const minePlaceholder = document.getElementById('mine-placeholder');
const mineSummary = document.getElementById('mine-summary');
const mineCount = document.getElementById('mine-count');
const closeRight = document.getElementById('close-right');
const hamburgerRight = document.getElementById('hamburger-right');
const routeInfo = document.getElementById('route-info');
const routeContent = document.getElementById('route-content');

const API = '';

function setStatus(msg, type = 'info') {
    statusMsg.textContent = msg;
    statusMsg.className = 'status-message ' + type;
}

function clearStatus() {
    statusMsg.textContent = '';
    statusMsg.className = 'status-message';
}

function showLoading(btn, text = 'Loading...') {
    btn.disabled = true;
    btn._originalText = btn.textContent;
    btn.textContent = text;
}

function hideLoading(btn) {
    btn.disabled = false;
    if (btn._originalText) {
        btn.textContent = btn._originalText;
    }
}

async function fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

function filterPortSelect(select, searchInput) {
    const term = searchInput.value.toLowerCase().trim();
    const options = select.options;
    for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (!opt.value) continue;
        const text = opt.textContent.toLowerCase();
        opt.style.display = (!term || text.includes(term)) ? '' : 'none';
    }
}

async function loadPorts() {
    try {
        const data = await fetchJSON(`${API}/api/ports`);
        state.allPorts = data.ports || [];
        populatePortSelect(originSelect, state.allPorts);
        populatePortSelect(destSelect, state.allPorts);
        return state.allPorts;
    } catch (err) {
        setStatus('Failed to load ports: ' + err.message, 'error');
        return [];
    }
}

function populatePortSelect(select, ports) {
    select.innerHTML = '<option value="">Select port...</option>';
    ports.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.country || '?'})`;
        select.appendChild(opt);
    });
}

async function loadCommodities() {
    try {
        const data = await fetchJSON(`${API}/api/commodities`);
        const commodities = data.commodities || [];
        
        commoditySelect.innerHTML = '<option value="all" selected>All commodities</option>';
        commodities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.toLowerCase();
            opt.textContent = c;
            commoditySelect.appendChild(opt);
        });
        
        commoditySelect.addEventListener('change', () => {
            const allOption = commoditySelect.querySelector('option[value="all"]');
            const selected = [...commoditySelect.selectedOptions].map(o => o.value);
            
            if (selected.includes('all')) {
                if (selected.length > 1) {
                    commoditySelect.value = [];
                    allOption.selected = true;
                }
            } else {
                allOption.selected = false;
                if ([...commoditySelect.selectedOptions].length === 0) {
                    allOption.selected = true;
                }
            }
        });
        
        return commodities;
    } catch (err) {
        setStatus('Failed to load commodities: ' + err.message, 'error');
        return [];
    }
}

function getSelectedCommodities() {
    const selected = [...commoditySelect.selectedOptions].map(o => o.value).filter(v => v !== 'all');
    if (selected.length === 0) return '';
    return selected.join(',');
}

async function calculateRoute() {
    const originId = originSelect.value;
    const destId = destSelect.value;
    
    if (!originId || !destId) {
        setStatus('Please select both origin and destination ports.', 'error');
        return;
    }
    
    if (originId === destId) {
        setStatus('Origin and destination must be different ports.', 'error');
        return;
    }
    
    showLoading(btnCalculate);
    clearStatus();
    
    try {
        const data = await fetchJSON(`${API}/api/route?origin_port_id=${originId}&dest_port_id=${destId}`);
        
        state.originPort = data.origin;
        state.destPort = data.destination;
        
        if (data.route && data.route.geometry && data.route.geometry.coordinates) {
            const coords = data.route.geometry.coordinates;
            coords[0] = [data.origin.longitude, data.origin.latitude];
            coords[coords.length - 1] = [data.destination.longitude, data.destination.latitude];
            data.route.geometry.coordinates = coords;
        }
        state.routeGeojson = data.route;
        
        routeLayer.clearLayers();
        chokepointsLayer.clearLayers();
        portMarkers.clearLayers();
        minesLayer.clearLayers();
        roadLayer.clearLayers();
        state.mines = [];
        state.chokepoints = [];
        state.roadRoute = null;
        
        renderRoute(data.route);
        addPortMarker(data.origin, '#4a9eff', 'ORIGIN');
        addPortMarker(data.destination, '#ff6b35', 'DEST');
        
        await loadChokepoints(data.route);
        fitMapToRoute(data.route);
        showRouteInfo(data);
        
        clearMineList();
        
        collapseRightSidebar();
        
        setStatus(`Route: ${data.origin.name} → ${data.destination.name}`, 'success');
    } catch (err) {
        setStatus('Route error: ' + err.message, 'error');
    } finally {
        hideLoading(btnCalculate);
    }
}

async function loadChokepoints(routeGeojson) {
    try {
        const geoStr = JSON.stringify(routeGeojson);
        const data = await fetchJSON(`${API}/api/chokepoints?route_geojson=${encodeURIComponent(geoStr)}&proximity_km=50`);
        state.chokepoints = data.chokepoints || [];
        renderChokepoints(state.chokepoints);
        
        if (state.chokepoints.length === 0) {
            setStatus('No chokepoints detected on this route.', 'info');
        }
    } catch (err) {
        console.error('Chokepoint error:', err);
    }
}

async function findMines() {
    const commodity = getSelectedCommodities();
    const radius = parseInt(radiusSlider.value);
    
    if (!state.destPort) {
        setStatus('Please calculate a route first to select destination port.', 'error');
        return;
    }
    
    if (!commodity) {
        setStatus('Please select at least one commodity.', 'error');
        return;
    }
    
    showLoading(btnFindMines);
    clearStatus();
    
    try {
        const { latitude, longitude } = state.destPort;
        let url = `${API}/api/mines?commodity=${encodeURIComponent(commodity)}&lat=${latitude}&lon=${longitude}&radius=${radius}`;
        const data = await fetchJSON(url);
        
        state.mines = data.mines || [];
        
        minesLayer.clearLayers();
        roadLayer.clearLayers();
        state.roadRoute = null;
        
        renderMines(state.mines);
        
        if (state.mines.length > 0) {
            const bounds = L.latLngBounds(state.mines.map(m => [m.latitude, m.longitude]));
            if (state.originPort) {
                bounds.extend([state.originPort.latitude, state.originPort.longitude]);
            }
            bounds.extend([state.destPort.latitude, state.destPort.longitude]);
            map.fitBounds(bounds, { padding: [50, 50] });
        }
        
        if (state.mines.length === 0) {
            setStatus(`No mines found for selected commodities within ${radius} km of ${state.destPort.name}.`, 'info');
            if (state.routeGeojson) fitMapToRoute(state.routeGeojson);
            clearMineList();
        } else {
            setStatus(`Found ${state.mines.length} mine(s) within ${radius} km.`, 'success');
            showMineList();
        }
    } catch (err) {
        setStatus('Mine search error: ' + err.message, 'error');
    } finally {
        hideLoading(btnFindMines);
    }
}

async function loadRoadRoute(mine) {
    if (!state.destPort) return;
    
    try {
        const data = await fetchJSON(
            `${API}/api/road-route?port_lat=${state.destPort.latitude}&port_lon=${state.destPort.longitude}&mine_lat=${mine.latitude}&mine_lon=${mine.longitude}`
        );
        
        state.roadRoute = data.route;
        roadLayer.clearLayers();
        
        if (data.route && data.route.geometry) {
            const coords = data.route.geometry.coordinates.map(c => [c[1], c[0]]);
            const polyline = L.polyline(coords, {
                color: '#ff6b35',
                weight: 3,
                opacity: 0.8,
                dashArray: '10, 10',
            });
            roadLayer.addLayer(polyline);
        }
    } catch (err) {
        setStatus('Road route error: ' + err.message, 'error');
    }
}

function renderRoute(geojson) {
    if (!geojson || !geojson.geometry) return;
    
    const coords = geojson.geometry.coordinates.map(c => [c[1], c[0]]);
    const polyline = L.polyline(coords, {
        color: '#4a9eff',
        weight: 3,
        opacity: 0.9,
    });
    routeLayer.addLayer(polyline);
}

function addPortMarker(port, color, label) {
    const icon = L.divIcon({
        className: 'port-marker-custom',
        html: `<div style="width:12px;height:12px;background:${color};border:2px solid #fff;border-radius:50%;"></div><div style="font-size:10px;color:#fff;text-align:center;font-weight:600;text-shadow:0 1px 2px #000;margin-top:2px;">${label}</div>`,
        iconSize: [12, 24],
        iconAnchor: [6, 12],
        popupAnchor: [0, -24],
    });
    
    const marker = L.marker([port.latitude, port.longitude], { icon })
        .bindPopup(`
            <div class="custom-popup-inner">
                <strong>${port.name}</strong><br>
                ${port.country}<br>
                <em>${label}</em>
            </div>
        `);
    
    portMarkers.addLayer(marker);
}

function renderMines(mines) {
    minesLayer.clearLayers();
    
    mines.forEach(mine => {
        const color = getCommodityColor(mine.commodity);
        const icon = createMineIcon(color);
        
        const marker = L.marker([mine.latitude, mine.longitude], { icon })
            .bindPopup(`
                <div class="custom-popup-inner">
                    <strong>${mine.name}</strong><br>
                    Commodity: ${mine.commodity}<br>
                    Distance: ${mine.distance_km} km<br>
                    Country: ${mine.country}<br>
                    <button onclick="window._showRoadToMine('${mine.id}')" style="margin-top:6px;padding:4px 10px;background:#ff6b35;color:#fff;border:none;cursor:pointer;font-size:11px;">Show Road Route</button>
                </div>
            `);
        
        marker.on('click', () => {
            map.setView([mine.latitude, mine.longitude], 8, { animate: true });
        });
        
        marker.on('mouseover', () => {
            marker.openPopup();
        });
        
        minesLayer.addLayer(marker);
    });
    
    window._mineById = {};
    mines.forEach(m => { window._mineById[m.id] = m; });
    window._showRoadToMine = function(id) {
        const mine = window._mineById[id];
        if (mine) {
            loadRoadRoute(mine);
            const card = document.querySelector(`.mine-card[data-mine-id="${id}"]`);
            if (card) {
                expandMineCard(card);
            }
        }
    };
}

function renderChokepoints(chokepoints) {
    chokepointsLayer.clearLayers();
    
    chokepoints.forEach(cp => {
        const icon = createDivIcon('chokepoint-marker', '!', 14);
        const marker = L.marker([cp.latitude, cp.longitude], { icon })
            .bindPopup(`
                <div class="custom-popup-inner">
                    <strong>${cp.name}</strong><br>
                    ${cp.description}<br>
                    ${cp.strategic_importance}<br>
                    Distance from route: ${cp.distance_km} km
                </div>
            `);
        
        marker.on('click', () => {
            map.setView([cp.latitude, cp.longitude], 6, { animate: true });
        });
        
        marker.on('mouseover', () => {
            marker.openPopup();
        });
        
        chokepointsLayer.addLayer(marker);
    });
}

function fitMapToRoute(geojson) {
    if (!geojson || !geojson.geometry) return;
    const coords = geojson.geometry.coordinates.map(c => [c[1], c[0]]);
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });
}

function collapseRightSidebar() {
    rightSidebar.classList.add('collapsed');
    hamburgerRight.style.display = 'flex';
}

function expandRightSidebar() {
    rightSidebar.classList.remove('collapsed');
    hamburgerRight.style.display = 'none';
}

function clearMineList() {
    mineList.innerHTML = '';
    mineList.style.display = 'none';
    mineListLoading.style.display = 'none';
    mineSummary.style.display = 'none';
    minePlaceholder.style.display = 'block';
    state.renderedMineCount = 0;
    state.isScrollingLoading = false;
}

function showMineList() {
    mineList.innerHTML = '';
    mineList.style.display = 'block';
    minePlaceholder.style.display = 'none';
    mineSummary.style.display = 'block';
    mineCount.textContent = state.mines.length;
    
    state.renderedMineCount = 0;
    state.isScrollingLoading = false;
    
    expandRightSidebar();
    
    renderMoreMines();
}

function renderMoreMines() {
    if (state.isScrollingLoading) return;
    if (state.renderedMineCount >= state.mines.length) {
        mineListLoading.style.display = 'none';
        return;
    }
    
    state.isScrollingLoading = true;
    mineListLoading.style.display = 'block';
    
    const end = Math.min(state.renderedMineCount + state.infiniteScrollBatchSize, state.mines.length);
    
    for (let i = state.renderedMineCount; i < end; i++) {
        const mine = state.mines[i];
        const color = getCommodityColor(mine.commodity);
        const card = document.createElement('div');
        card.className = 'mine-card';
        card.dataset.mineId = mine.id;
        card.dataset.index = i;
        
        card.innerHTML = `
            <div class="mine-card-header">
                <div class="mine-color-dot" style="background:${color};"></div>
                <span class="mine-card-title" title="${mine.name}">${mine.name}</span>
                <span class="mine-card-distance">${mine.distance_km} km</span>
                <span class="mine-card-arrow">&#9654;</span>
            </div>
            <div class="mine-card-body">
                <div class="label-value">
                    <span class="dlabel">Commodity</span>
                    <span class="dvalue">${mine.commodity}</span>
                </div>
                <div class="label-value">
                    <span class="dlabel">Country</span>
                    <span class="dvalue">${mine.country}</span>
                </div>
                <div class="label-value">
                    <span class="dlabel">Status</span>
                    <span class="dvalue">${mine.status || 'Unknown'}</span>
                </div>
                <div class="label-value">
                    <span class="dlabel">Distance from Port</span>
                    <span class="dvalue">${mine.distance_km} km</span>
                </div>
                <div class="mine-card-actions">
                    <button class="btn-zoom" data-mine-id="${mine.id}">Zoom</button>
                    <button class="btn-road" data-mine-id="${mine.id}">Road Route</button>
                </div>
            </div>
        `;
        
        const header = card.querySelector('.mine-card-header');
        header.addEventListener('click', (e) => {
            card.classList.toggle('expanded');
        });
        
        const zoomBtn = card.querySelector('.btn-zoom');
        zoomBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            map.setView([mine.latitude, mine.longitude], 8, { animate: true });
            expandMineCard(card);
        });
        
        const roadBtn = card.querySelector('.btn-road');
        roadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            loadRoadRoute(mine);
            expandMineCard(card);
        });
        
        mineList.appendChild(card);
    }
    
    state.renderedMineCount = end;
    state.isScrollingLoading = false;
    mineListLoading.style.display = 'none';
    
    checkInfiniteScroll();
}

function expandMineCard(card) {
    if (card) {
        document.querySelectorAll('.mine-card.expanded').forEach(c => {
            if (c !== card) c.classList.remove('expanded');
        });
        card.classList.add('expanded');
    }
}

function checkInfiniteScroll() {
    if (!mineList || mineList.style.display === 'none') return;
    if (state.renderedMineCount >= state.mines.length) return;
    
    const scrollThreshold = 50;
    const scrollPos = mineList.scrollTop + mineList.clientHeight;
    const scrollTotal = mineList.scrollHeight;
    
    if (scrollTotal - scrollPos <= scrollThreshold) {
        renderMoreMines();
    }
}

function showRouteInfo(data) {
    routeInfo.style.display = 'block';
    routeInfo.style.borderTop = '1px solid var(--border-color)';
    
    const html = `
        <div class="label-value">
            <span class="dlabel">Origin</span>
            <span class="dvalue">${data.origin.name}</span>
        </div>
        <div class="label-value">
            <span class="dlabel">Destination</span>
            <span class="dvalue">${data.destination.name}</span>
        </div>
        <div class="label-value">
            <span class="dlabel">Country (Dest)</span>
            <span class="dvalue">${data.destination.country}</span>
        </div>
    `;
    
    routeContent.innerHTML = html;
}

function clearAll() {
    originSearch.value = '';
    destSearch.value = '';
    originSelect.value = '';
    destSelect.value = '';
    
    const allOption = commoditySelect.querySelector('option[value="all"]');
    if (allOption) allOption.selected = true;
    [...commoditySelect.options].forEach(o => { if (o.value !== 'all') o.selected = false; });
    
    radiusSlider.value = 1000;
    radiusValue.textContent = '1000';
    
    routeLayer.clearLayers();
    minesLayer.clearLayers();
    chokepointsLayer.clearLayers();
    roadLayer.clearLayers();
    portMarkers.clearLayers();
    
    state.originPort = null;
    state.destPort = null;
    state.routeGeojson = null;
    state.mines = [];
    state.chokepoints = [];
    state.roadRoute = null;
    state.selectedMine = null;
    
    clearMineList();
    routeInfo.style.display = 'none';
    
    collapseRightSidebar();
    
    map.setView([20, 0], 2);
    clearStatus();
}

radiusSlider.addEventListener('input', () => {
    radiusValue.textContent = radiusSlider.value;
});

btnCalculate.addEventListener('click', calculateRoute);
btnFindMines.addEventListener('click', findMines);
btnClear.addEventListener('click', clearAll);

closeRight.addEventListener('click', () => {
    collapseRightSidebar();
});

hamburgerRight.addEventListener('click', () => {
    expandRightSidebar();
});

mineList.addEventListener('scroll', () => {
    checkInfiniteScroll();
});

originSearch.addEventListener('input', () => filterPortSelect(originSelect, originSearch));
destSearch.addEventListener('input', () => filterPortSelect(destSelect, destSearch));

async function init() {
    setStatus('Loading ports data...', 'info');
    await loadPorts();
    await loadCommodities();
    clearStatus();
    setStatus('Select ports and calculate a route to begin.', 'info');
}

init();
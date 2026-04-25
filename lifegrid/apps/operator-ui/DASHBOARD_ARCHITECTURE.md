# LIFEGRID Command Center – Dashboard Architecture
## Tactical Operator Interface · Black/White · High-Density

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TOP BAR (48px)                                                             │
│  [LG] [ALERT:NORMAL] [ACTIVE:12] [CRITICAL:2] [AVAIL:24] [DEPLOYED:8]     │
│  LEFT TABS: [1:Incidents] [2:Priority] [3:Agencies] [4:Log]                │
│  RIGHT TABS: [q:Detail] [w:AI] [e:Comms] [r:Satellite]  [Broadcast]       │
├──────────────┬──────────────────────────────────┬──────────────────────────┤
│              │                                  │                          │
│  LEFT PANEL  │     TACTICAL MAP (CENTER)        │   RIGHT PANEL            │
│  (260px)     │     2 columns × 2 rows           │   (300px)                │
│              │                                  │                          │
│  Tab 1:      │  • Incident markers (severity)   │  Tab q: Incident Detail  │
│  Incident    │  • Responder positions           │  Tab w: AI Suggestions   │
│  List        │  • Heatmap overlay               │  Tab e: Communications   │
│              │  • Flood zone circles            │  Tab r: Satellite Data   │
│  Tab 2:      │  • Evacuation routes             │                          │
│  Priority    │  • Layer controls (top-right)    │                          │
│  Queue       │  • Zoom/fit controls (top-left)  │                          │
│              │  • Coordinate display (bottom)   │                          │
│  Tab 3:      │  • Severity legend (bottom-left) │                          │
│  Agencies    │  • Flood legend (conditional)    │                          │
│              │                                  │                          │
│  Tab 4:      │                                  │                          │
│  System Log  │                                  │                          │
│              │                                  │                          │
├──────────────┴──────────────────────────────────┴──────────────────────────┤
│  ANALYTICS BAR (180px)                                                      │
│  [KPI Metrics] [24h Area Chart] [Type Bar Chart] [Responder Bars] [ETA Line]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### Grid Definition
```css
.command-grid {
  grid-template-columns: 260px 1fr 1fr 300px;
  grid-template-rows: 48px 1fr 1fr 180px;
}
```

---

## Module 1: Live Incident Feed (Left Panel – Tab 1)

### Component: `IncidentList`

```
IncidentList
├── SearchBar (fuzzy search: code, type, city)
├── SeverityFilter (ALL | C | H | M | L)
├── SortToggle (severity | time)
└── IncidentRow[] (virtualized)
    ├── SeverityDot (animated for CRITICAL)
    ├── ReferenceCode + StatusBadge
    ├── IncidentType
    ├── Location (city or coordinates)
    └── TimeAgo
```

**Behavior:**
- CRITICAL rows have pulsing red dot + `border-left: 3px solid #ff1744`
- Selected row highlighted with `bg-[#121212]`
- Clicking a row → sets `selectedIncidentId` + switches right panel to `detail`
- Real-time updates via WebSocket `INCIDENT_CREATED` / `INCIDENT_UPDATED`
- Max 200 incidents in memory (oldest dropped)

---

## Module 2: GIS Map with Responders (Center)

### Component: `TacticalMap`

```
TacticalMap
├── MapContainer (Leaflet)
│   ├── TileLayer (standard | satellite | terrain)
│   ├── MapController (auto-pan to selected incident)
│   ├── HeatmapLayer (canvas, mix-blend-mode: screen)
│   ├── LayerGroup: FloodZones (Circle, dashed)
│   ├── LayerGroup: EvacuationRoutes (Circle, dashed yellow)
│   ├── LayerGroup: IncidentMarkers
│   │   ├── Marker (severity-colored dot)
│   │   ├── Popup (severity, type, code, risk score)
│   │   └── Circle (affected zone for CRITICAL)
│   └── LayerGroup: ResponderPositions
│       ├── Marker (type-colored dot, heading rotation)
│       └── Popup (type, status, incident ref)
├── LayerControlPanel (top-right, AnimatePresence)
│   ├── BasemapSelector (standard | satellite | terrain)
│   └── OverlayToggles (8 layers with color dots)
├── MapControls (top-left: zoom in/out, fit all, reset)
├── SeverityLegend (bottom-left)
├── FloodLegend (bottom-left, conditional)
└── CoordinateDisplay (bottom-right, live lat/lng/zoom)
```

### Map Layers

| Layer | Type | Color | Data Source |
|-------|------|-------|-------------|
| Crisis Heatmap | Canvas radial gradient | Red→Orange→Yellow | `/analytics/heatmap` |
| Flood Zones | Leaflet Circle | Blue (#00aaff) | `/ai/flood/predict` |
| Traffic | TileLayer overlay | Yellow | External API |
| Satellite | ESRI World Imagery | — | ESRI tile server |
| Weather | WMS overlay | Gray | NOAA/ECMWF |
| Vegetation (NDVI) | Raster overlay | Green | Sentinel-2 |
| Population | Choropleth | White | WorldPop |
| Evacuation Routes | Dashed circles | Yellow | Computed |

### Heatmap Algorithm
```
For each incident point (lat, lng, weight):
  radius = max(20, weight × 30) pixels
  gradient = radial(
    center: rgba(255,23,68, weight×0.8),
    mid:    rgba(255,109,0, weight×0.5),
    edge:   rgba(255,214,0, 0)
  )
  draw filled circle on canvas
Re-render on map move/zoom
```

---

## Module 3: AI Decision Suggestions (Right Panel – Tab w)

### Component: `AISuggestionsPanel`

```
AISuggestionsPanel
├── PanelHeader (count badge, model version)
├── SuggestionCard[] (pending)
│   ├── TypeIcon + PriorityBadge + Timestamp
│   ├── Title
│   ├── ConfidenceBar (animated fill)
│   ├── ConfidenceScore + RiskScore
│   └── [Expanded]
│       ├── Description
│       ├── FactorTags
│       └── ActionButtons (PRIMARY | SECONDARY | DISMISS)
└── CompletedSection (collapsed, last 5)
```

### Suggestion Types
| Type | Trigger | Color |
|------|---------|-------|
| DISPATCH | New HIGH/CRITICAL incident | Blue |
| ESCALATE | Risk score > 80 | Red |
| RESOURCE | Resource shortage detected | Yellow |
| ROUTE | Traffic/hazard on route | Green |
| PREDICTION | Flood/weather forecast | Gray |
| DEESCALATE | Incident stabilizing | Green |

### Confidence Visual
```
< 0.6  → left border: #ff6d00 (low confidence)
0.6–0.8 → left border: #ffd600 (medium)
> 0.8  → left border: #00c853 (high confidence)
```

---

## Module 4: Communication Panel (Right Panel – Tab e)

### Component: `CommPanel`

```
CommPanel
├── PanelHeader (unread count)
├── ChannelList (128px wide, scrollable)
│   └── ChannelRow[]
│       ├── ChannelIcon (Radio|Hash|Megaphone|Lock)
│       ├── ChannelName + UnreadBadge
│       ├── LastMessage preview
│       └── AgencyStatusDot (if agency channel)
└── MessageArea
    ├── ChannelHeader (name + frequency)
    ├── MessageList (scrollable, aria-live)
    │   └── MessageRow[]
    │       ├── TimestampDivider (>60s gap)
    │       ├── SenderName + AgencyTag + TypeBadge
    │       └── MessageBubble (own=white, other=dark)
    └── InputArea
        ├── PrioritySelector (NORMAL | URGENT | EMERGENCY)
        ├── TextArea (Enter to send)
        └── SendButton
```

### Channel Types
| Type | Icon | Description |
|------|------|-------------|
| BROADCAST | Megaphone | All agencies |
| AGENCY | Radio | Direct to specific agency |
| INCIDENT | Hash | Incident-specific channel |
| ENCRYPTED | Lock | Secure command channel |

---

## Module 5: Satellite Monitoring (Right Panel – Tab r)

### Component: `SatellitePanel`

```
SatellitePanel
├── PanelHeader (refresh button)
├── SourceSelector (S2 | S1 | G16 | L9)
├── SourceInfo (name, resolution, coverage, last update)
├── ReadingsTable
│   └── ReadingRow[]
│       ├── Label
│       ├── TrendArrow (↑↓→)
│       ├── Value (color-coded by status)
│       └── StatusDot
├── LayerToggles (all 8 map layers with toggle switches)
└── QuickAnalysis
    ├── [Run Flood Prediction] → POST /ai/flood/predict
    ├── [Show Vegetation Index] → toggle NDVI layer
    └── [Show Crisis Heatmap] → toggle heatmap layer
```

### Satellite Sources
| Source | Type | Resolution | Cadence |
|--------|------|-----------|---------|
| Sentinel-2 | Optical | 10m | 5 days |
| Sentinel-1 | SAR | 5m | 6 days |
| GOES-16 | Weather | 2km | 10 min |
| Landsat-9 | Thermal | 30m | 16 days |

---

## Advanced Features

### Heatmap for Crisis Zones
- Canvas-based radial gradient rendering (not Leaflet layer)
- `mix-blend-mode: screen` for transparent overlay
- Re-renders on every map move/zoom event
- Data from `/analytics/heatmap` (7-day incident density)
- Weight = incident count per grid cell

### Real-time Flood Overlay
- Triggered by: satellite NDWI > 0.3, sensor water_level > 100cm, rainfall > 80mm/24h
- Rendered as dashed Leaflet Circle per risk zone
- Opacity proportional to flood probability
- Popup shows: probability %, risk level, estimated population
- Data from `/ai/flood/predict` (U-Net + rule engine)

### Multi-Agency Coordination
- 6 default agencies with live status (ONLINE/BUSY/STANDBY/OFFLINE)
- Per-agency deployment bar (available/deployed ratio)
- Direct message channel per agency
- Broadcast modal → sends to all channels + WebSocket
- Agency status updates via WebSocket

### Alert Prioritization System
- Priority score = severity (40) + type risk (40) + age bonus (20)
- Sorted descending by score in Priority Queue tab
- One-click assignment to current operator
- Score color: ≥80 red, ≥60 orange, ≥40 yellow, <40 green
- Auto-populated from incident list on data fetch

---

## Data Flow Structure

```
WebSocket (Socket.IO)
    │
    ├── INCIDENT_CREATED ──────────────────────────────────────────────────────┐
    │   → addIncident(payload)                                                  │
    │   → addLogEntry(INCIDENT)                                                 │
    │   → addAISuggestion() [if CRITICAL/HIGH]                                  │
    │                                                                           │
    ├── INCIDENT_UPDATED ──────────────────────────────────────────────────────┤
    │   → updateIncident(id, payload)                                           │
    │                                                                           │
    ├── RESPONDER_LOCATION_UPDATE ─────────────────────────────────────────────┤
    │   → updateResponderPosition(pos)                                          │
    │   → TacticalMap re-renders responder marker                               │
    │                                                                           │
    ├── DISPATCH_SENT ─────────────────────────────────────────────────────────┤
    │   → addLogEntry(DISPATCH)                                                 │
    │                                                                           │
    ├── SENSOR_ALERT ──────────────────────────────────────────────────────────┤
    │   → addLogEntry(SENSOR)                                                   │
    │                                                                           │
    ├── ALERT_LEVEL_CHANGE ────────────────────────────────────────────────────┤
    │   → setAlertLevel(level)                                                  │
    │   → TopBar alert badge updates                                            │
    │   → AlertBanner overlay on map                                            │
    │                                                                           │
    ├── OPERATOR_BROADCAST ────────────────────────────────────────────────────┤
    │   → addLogEntry(BROADCAST)                                                │
    │   → addCommMessage('ch-all', msg)                                         │
    │                                                                           │
    └── GUIDANCE_MESSAGE ──────────────────────────────────────────────────────┘
        → addCommMessage('ch-inc-{id}', msg)

REST API (React Query)
    │
    ├── GET /incidents?pageSize=100 ──────────────────────────────────────────┐
    │   refetchInterval: 20s                                                   │
    │   → setIncidents()                                                       │
    │   → setPriorityQueue() [computed from incidents]                         │
    │                                                                           │
    ├── GET /analytics/metrics ────────────────────────────────────────────────┤
    │   refetchInterval: 8s                                                    │
    │   → setMetrics()                                                         │
    │   → TopBar KPI values update                                             │
    │                                                                           │
    └── GET /analytics/heatmap ────────────────────────────────────────────────┘
        refetchInterval: 60s
        → setHeatmapPoints()
        → HeatmapLayer re-renders on next map interaction

Operator Actions → REST API
    │
    ├── PATCH /incidents/:id ─────────────────────────────────────────────────┐
    │   (status update, note, assignment)                                      │
    │                                                                           │
    ├── POST /incidents/:id/verify ────────────────────────────────────────────┤
    │   (dual verification closure)                                            │
    │                                                                           │
    ├── POST /ai/flood/predict ────────────────────────────────────────────────┤
    │   → setFloodZones()                                                      │
    │   → toggleLayer('flood')                                                 │
    │                                                                           │
    └── POST /ai/safety/stream ────────────────────────────────────────────────┘
        (wearable safety alert)
```

---

## Operator Workflow

### Standard Incident Response
```
1. INCIDENT_CREATED event arrives
   → Incident appears in list (left panel, tab 1)
   → AI suggestion generated (right panel, tab w badge +1)
   → Map marker appears

2. Operator clicks incident row
   → selectedIncidentId set
   → Right panel switches to Detail tab
   → Map pans to incident location

3. Operator reviews AI suggestion (tab w)
   → Reads confidence score, risk score, factors
   → Clicks "Accept & Dispatch"
   → API call to dispatch endpoint
   → Suggestion marked as acted-on

4. Responders dispatched
   → DISPATCH_SENT event → log entry
   → Responder dots appear on map
   → ETA shown in incident detail

5. Operator monitors via map
   → Responder dots move in real time
   → Incident status updates: DISPATCHED → EN_ROUTE → ON_SCENE

6. Operator adds notes, communicates via Comms panel
   → Message sent to agency channel
   → Logged permanently

7. Incident resolved
   → Operator clicks "Verify & Close"
   → POST /incidents/:id/verify
   → Incident removed from active list
   → Priority queue updated
```

### Flood Emergency Workflow
```
1. Sensor alert: water_level > 100cm
   → SENSOR_ALERT event → log entry
   → AI suggestion: PREDICTION type

2. Operator opens Satellite panel (tab r)
   → Reviews NDWI reading (elevated)
   → Clicks "Run Flood Prediction"
   → POST /ai/flood/predict

3. Flood zones returned
   → setFloodZones() called
   → Flood layer auto-enabled on map
   → Blue dashed circles appear

4. Operator broadcasts evacuation order
   → Clicks "Broadcast" button in TopBar
   → Selects "Evacuation Order" template
   → Sets priority: EMERGENCY
   → Sends → all agency channels notified

5. Agencies respond
   → Status updates in Agency panel (tab 3)
   → Messages arrive in Comms panel (tab e)
   → Responder positions update on map
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Left panel: Incidents |
| `2` | Left panel: Priority Queue |
| `3` | Left panel: Agencies |
| `4` | Left panel: System Log |
| `q` | Right panel: Incident Detail |
| `w` | Right panel: AI Suggestions |
| `e` | Right panel: Communications |
| `r` | Right panel: Satellite |
| `Esc` | Deselect incident |

---

## Design Principles

**Information density:** Every pixel carries data. No decorative elements. Font sizes 7–13px. Monospace for all data values.

**Color semantics:** White = selected/active. Green = safe/available. Yellow = elevated/warning. Orange = high alert. Red = critical/emergency. Gray = inactive/offline.

**Hierarchy:** Critical incidents always float to top of lists. CRITICAL severity dots pulse. Alert banner overlays map when level > GREEN.

**Latency:** WebSocket events update UI in <50ms. React Query refetch intervals tuned per data volatility (metrics: 8s, incidents: 20s, heatmap: 60s).

**Resilience:** All panels show empty states gracefully. Demo data shown when API unavailable. No broken layouts on missing data.

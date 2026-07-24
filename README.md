# ArchitectAI-Agent

A **client-side AI-powered architectural floor plan generator and 3D home designer**. Describe your dream home in natural language and watch it come to life — from layout generation to interior design, cost estimation, Vastu compliance, and full 3D walkthroughs.

> **Zero backend. Zero API keys. Everything runs in your browser.**

---

## Features

- **Natural Language Input** — Describe your home in plain English (e.g., *"3BHK modern home, 1800 sqft, large living room"*) and the app extracts room counts, area, style, direction, and budget automatically.
- **6-Step Wizard** — Guided workflow from description → area → rooms → layout → theme → final plan.
- **4+ Layout Strategies** — Shelf, Grid, Corridor, Open Plan, and Custom layout variants generated algorithmically.
- **Interactive 2D Floor Plan** — Pan, zoom, drag rooms to move/swap, measure distances, view dimensions and furniture footprints on an HTML5 Canvas.
- **Immersive 3D Viewer** — Three.js-powered 3D model with Orbit, Walk (WASD), Bird's Eye, and Room View camera modes. Time-of-day lighting with sun position control.
- **80+ Furniture Items** — Procedural 3D furniture across 9 categories (Bedroom, Living, Dining, Kitchen, Bath, Office, Outdoor, Decor, Misc) with drag-to-place editing.
- **6 Interior Themes** — Modern, Minimalist, Luxury, Scandinavian, Industrial, and Traditional — each affecting wall colors, floor materials, furniture, and lighting.
- **AI Insights** — Cost estimation, Vastu Shastra compliance scoring (7 rules), and natural light/ventilation analysis.
- **Multi-Format Export** — PNG, SVG, JSON, GLTF, GLB, OBJ, and STL.
- **Undo/Redo** — Full history stack (50 states) for all layout edits.
- **Auto-Save** — State persists to `localStorage` and restores on reload.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | ^18.2.0 | UI framework |
| **Three.js** | ^0.160.0 | 3D rendering, model building, GLTF/OBJ/STL export |
| **Vite** | ^5.0.0 | Build tool and dev server |
| **JavaScript (ES Modules)** | ES2020+ | Entire codebase |
| **CSS3** | — | Custom properties, Flexbox, Grid, animations |

**Fonts:** DM Sans (headings), Inter (body), JetBrains Mono (dimensions)

---

## Project Structure

```
ArchitectAI-Agent/
├── index.html                       # HTML entry point
├── package.json                     # NPM config & scripts
├── vite.config.js                   # Vite + React plugin config
└── src/
    ├── main.jsx                     # React DOM mount point
    ├── App.jsx                      # Root component — wizard orchestration
    ├── styles/
    │   └── app.css                  # All styles (CSS custom properties, animations)
    ├── hooks/
    │   └── useFloorPlan.js          # Central state management (rooms, layout, undo/redo, localStorage)
    ├── components/
    │   ├── StepNav.jsx              # Step progress indicator
    │   ├── StepPrompt.jsx           # Step 0 — Natural language input
    │   ├── StepAreaInput.jsx        # Step 1 — Total area + dimensions
    │   ├── UnitToggle.jsx           # ft² / m² toggle
    │   ├── StepRoomConfig.jsx       # Step 2 — Room selection & sizing
    │   ├── RoomCard.jsx             # Room type toggle card
    │   ├── StepLayoutSelect.jsx     # Step 3 — Layout variant picker
    │   ├── LayoutThumbnail.jsx      # SVG layout preview
    │   ├── StepThemeSelect.jsx      # Step 4 — Interior theme picker
    │   ├── StepFloorPlan.jsx        # Step 5 — Final 2D/3D view + editing
    │   ├── FloorPlanCanvas.jsx      # Interactive 2D Canvas renderer
    │   ├── FloorPlan3D.jsx          # Interactive 3D Three.js viewer
    │   ├── CustomLayoutBuilder.jsx  # Custom layout drag-and-drop editor
    │   ├── ExportPanel.jsx          # Export modal (PNG/SVG/JSON/GLTF/GLB/OBJ/STL)
    │   └── InsightsPanel.jsx        # Cost, Vastu, and Energy analysis
    └── engine/
        ├── types.js                 # JSDoc typedefs (Polygon, RoomCell, Wall, Opening, Layout)
        ├── constants.js             # Room types, dimensions, unit conversions
        ├── prng.js                  # Seeded PRNG (Mulberry32) for deterministic layouts
        ├── polygon.js               # 2D polygon geometry (split, clip, offset, contain)
        ├── roomCell.js              # RoomCell class with polygon + bbox compatibility
        ├── nlp.js                   # Client-side NLP parser (regex + heuristics)
        ├── subdivision.js           # Recursive binary subdivision (slicing tree) engine
        ├── adjacency.js             # Adjacency graph, scoring & hill-climbing optimizer
        ├── circulation.js           # Corridor spine carving for reachable room layouts
        ├── layout.js                # Legacy shelf-based room packing algorithm
        ├── layoutVariants.js        # 4 variant strategies + custom
        ├── geometry.js              # Wall merging, door/window placement
        ├── furniture.js             # 80+ item catalog & default placement
        ├── model3d.js               # Full Three.js 3D model builder (790 lines)
        ├── themes.js                # 6 interior design themes
        ├── vastu.js                 # Vastu Shastra compliance checker
        ├── costEstimator.js         # Per-room cost estimation
        ├── energyAnalyzer.js        # Natural light & ventilation analysis
        ├── exporters.js             # Multi-format export engine
        └── __tests__/               # Vitest unit tests
            ├── geometry.test.js
            ├── polygon.test.js
            ├── prng.test.js
            ├── roomCell.test.js
            └── subdivision.test.js
```

---

## How It Works

### 1. Natural Language Processing (`engine/nlp.js`)

A fully client-side NLP engine parses user input using regex patterns and heuristics. It extracts:
- **BHK count** (e.g., "3BHK" → 3 bedrooms)
- **Total area** (sqft or sqm)
- **Style** (modern, minimalist, luxury, etc.)
- **Compass direction** (north, south, east, west facing)
- **Floors** (single, double, multi-story)
- **Budget** (USD or INR with comma handling)
- **Amenities** (parking, garden, balcony, etc.)
- **Individual room mentions** with size modifiers (e.g., "large master bedroom")

It then auto-generates a full room specification list with smart defaults (e.g., a 3BHK automatically gets 2 bathrooms, kitchen, living room, dining area, etc.).

### 2. Layout Generation (`engine/subdivision.js` + `engine/layoutVariants.js`)

The primary layout engine uses **recursive binary subdivision** (slicing tree) to produce gap-free, exact-tiling room cells from a building footprint polygon. The algorithm:

1. Sorts rooms largest-first for balanced bisection
2. Chooses split axis based on polygon shape and variant policy
3. Partitions rooms into two groups by area using a greedy LPT approach
4. Recursively bisects until each region holds a single room
5. Assigns actual polygons from the slicing tree leaves

Four distinct layout strategies configure the subdivision via variant policies:

| Strategy | Description |
|----------|-------------|
| **Shelf** | Rooms arranged in horizontal rows, stretched to fill available width |
| **Grid** | Two-column compact grid layout (alternating split axes) |
| **Corridor** | Rooms flanking a central hallway (auto-carved via `circulation.js`) |
| **Open Plan** | Public rooms (living/dining/kitchen) merged in one open band; private rooms above |

A **Custom** mode provides a clean grid canvas for manual arrangement.

**Corridor Carving** (`engine/circulation.js`) — For plans >800 sqft with 5+ rooms, a corridor spine is carved from the footprint before subdivision, ensuring every room is reachable from the entry without passing through bedrooms or bathrooms.

**Adjacency Optimization** (`engine/adjacency.js`) — A weighted adjacency graph defines preferred room proximities (e.g., kitchen–dining = 9, bedroom–bathroom = 8). After initial subdivision, a hill-climbing optimizer mutates room assignments over 200 iterations to maximize the adjacency score (0–100). A BFS reachability check ensures all rooms are accessible from the entry.

**Polygon Geometry** (`engine/polygon.js`) — All subdivision operates on arbitrary convex/concave polygons using Sutherland-Hodgman clipping, polygon splitting, Minkowski-sum offsetting, and ray-casting point-in-polygon tests. This enables L-shaped and T-shaped room cells beyond simple rectangles.

Each variant calls `generateWalls()` (`engine/geometry.js`) which:
1. Merges room edges into minimal wall segments
2. Detects exterior vs. interior walls
3. Places doors (with swing arcs) and windows automatically

### 3. Furniture Placement (`engine/furniture.js`)

80+ furniture items are procedurally generated from box/cylinder primitives. Each room type has default furnishings:
- **Bedroom**: Bed, nightstands, wardrobe, dresser
- **Living Room**: Sofa set, coffee table, TV unit, bookshelf
- **Kitchen**: Counter, stove, sink, refrigerator, cabinets
- **Bathroom**: Toilet, sink vanity, shower, bathtub
- **Dining**: Table, chairs
- And more across Office, Outdoor, Decor, and Misc categories

### 4. 2D Rendering (`components/FloorPlanCanvas.jsx`)

An HTML5 Canvas renderer with:
- Room fills with color coding by type
- Labels and dimensions in JetBrains Mono
- Walls rendered as thick strokes
- Doors with swing arc indicators
- Windows with sill lines
- Furniture footprints
- Measurement/distance tool
- Pan, zoom, drag-to-move, drag-to-swap
- High-DPI awareness (`devicePixelRatio`)

### 5. 3D Visualization (`components/FloorPlan3D.jsx` + `engine/model3d.js`)

A complete Three.js scene with:

**Camera Modes:**
- **Orbit** — Rotate around the model freely
- **Walk** — First-person WASD + mouse look (pointer lock)
- **Bird's Eye** — Top-down view
- **Room View** — Inside a selected room

**Lighting:**
- Directional (sun) + hemisphere + ambient lights
- Time-of-day slider adjusts sun position, color temperature, and night sky

**3D Model Components:**
- Floors with UV-scaled textures (wood, tile, marble, concrete, grass)
- Walls with door/window cutouts, piers, sills, and lintels
- Doors with frames and handles
- Windows with mullions and glass panes
- Ceilings
- Roof slab with parapet
- 80+ furniture models

**Editing:**
- TransformControls gizmo (translate/rotate/scale)
- Properties panel for selected objects
- Add furniture from categorized catalog
- Toggle roof/ceiling/furniture visibility

### 6. Analysis Engines

**Vastu Shastra** (`engine/vastu.js`) — 7 compliance rules:
- Entrance direction
- Kitchen placement (SE preferred)
- Master bedroom placement (SW preferred)
- Bathroom placement (NW preferred)
- Pooja room placement (NE preferred)
- Staircase placement
- Center of house (Brahmasthan)

**Cost Estimator** (`engine/costEstimator.js`) — Per-room cost based on:
- Room type (kitchen and bathrooms cost more per sqft)
- Area
- Style multiplier (luxury > modern > minimalist)
- Finish level

**Energy Analyzer** (`engine/energyAnalyzer.js`) — Per-room scoring for:
- Natural light (based on window area and exterior wall exposure)
- Ventilation (based on window placement relative to room area)

### 7. Export System (`engine/exporters.js`)

| Format | Type | Details |
|--------|------|---------|
| PNG | 2D raster | Canvas `toBlob()` |
| SVG | 2D vector | Procedural markup with rooms, walls, doors, dimensions |
| JSON | Structured data | Complete layout data |
| GLTF | 3D model | Three.js GLTFExporter |
| GLB | 3D binary | Compact binary GLTF |
| OBJ | 3D mesh | Three.js OBJExporter |
| STL | 3D mesh | Three.js STLExporter (3D printing ready) |

---

## Getting Started

### Prerequisites

- **Node.js** v18+ (v16 minimum)
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd ArchitectAI-Agent

# Install dependencies
npm install
```

### Development

```bash
npm run dev
```

Opens a local dev server at `http://localhost:5173` with hot reload.

### Production Build

```bash
npm run build
```

Output is generated in the `dist/` directory. Serve it with any static file server.

### Testing

```bash
# Run tests once
npm run test

# Run tests in watch mode
npm run test:watch
```

Tests are located in `src/engine/__tests__/` and use **Vitest**. They cover polygon geometry, PRNG determinism, RoomCell creation, wall generation, and subdivision correctness.

### Optional: local open-weights model

The AI designer runs fully offline on its built-in rules. You can additionally
point it at any **open-weights model** to improve how it reads a description
and how it decides which rooms should adjoin which.

```bash
ollama pull qwen2.5:3b-instruct
cp .env.example .env.local        # then set VITE_LLM_ENABLED=true
```

The model path is **off by default**. A local 7B costs 60–90 seconds per call
and the designer makes two, so it is opt-in rather than something that
silently turns a two-second design into a three-minute one. `qwen2.5:3b-instruct`
is the better choice for interactive use.

That is the whole setup — `.env.example` documents every variable. Any
OpenAI-compatible endpoint works (Ollama, llama.cpp, LM Studio, vLLM, or a
hosted gateway); if the exact model tag you name is not installed, the client
binds to the closest instruction-tuned model the endpoint reports.

**What the model does and does not do**

| Stage | Owner | Why |
|-------|-------|-----|
| Description → room schedule | model (falls back to regex) | Handles open-ended phrasing: *"somewhere quiet to work from home"* → a study; *"a small prayer space"* → a pooja room |
| Room schedule → adjacency graph | model (falls back to built-in table) | The bubble diagram is architectural judgement, and it is per-home |
| Footprint subdivision | solver | Must tile exactly, with no gaps or overlaps |
| Circulation, doors, windows | solver | Must be metrically correct and verifiable |
| Scoring and candidate search | solver | Must be deterministic and reproducible |

A language model cannot emit metric floor-plan geometry — it has no way to
guarantee gap-free tiling, aligned wall lines, or rooms that hit their target
area. So it never draws. This is the same split used by the research work in
this area (Graph2Plan, House-GAN++, RPLAN): the model supplies semantics, a
constrained solver supplies geometry.

Every LLM call degrades silently to the deterministic path on timeout, a
missing model, malformed JSON, or an unreachable endpoint. The app never
requires one.

---

## Application Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Step 0     │────▶│  Step 1     │────▶│  Step 2     │
│  Describe   │     │  Set Area   │     │  Configure  │
│  Your Home  │     │  (sqft/m²)  │     │  Rooms      │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────┐     ┌─────▼───────┐
                    │  Step 4     │◀────│  Step 3     │
                    │  Pick Theme │     │  Pick Layout│
                    └──────┬──────┘     └─────────────┘
                           │
                     ┌─────▼───────┐
                     │  Step 5     │
                     │  View &     │
                     │  Edit Plan  │
                     │  (2D / 3D)  │
                     └─────────────┘
```

---

## Key Architecture Decisions

- **No backend** — The NLP engine, layout generation, 3D modeling, cost estimation, Vastu checking, energy analysis, and all exports happen entirely in the browser. No server, no database, no API keys.
- **Single state hook** — `useFloorPlan.js` manages all application state including undo/redo history and localStorage persistence.
- **Dual rendering** — The same layout data feeds both the 2D Canvas renderer and the Three.js 3D scene, toggled by the user.
- **Procedural 3D models** — All furniture and building geometry is generated from box/cylinder primitives at runtime. No external 3D model files.
- **Slicing tree subdivision** — Layouts are produced by recursive binary subdivision of polygon footprints, not shelf-packing. This guarantees gap-free, exact-tiling room cells with arbitrary shapes (L, T, corridor).
- **Deterministic PRNG** — All layout randomization uses a seeded Mulberry32 PRNG (`prng.js`), making layouts reproducible from a seed value.
- **Typed polygon engine** — The `polygon.js` module provides stateless, import-free geometry primitives (split, clip, offset, contain) that operate on `[x,y][]` vertex arrays, enabling non-rectangular room cells.
- **Extensible catalog** — Adding new furniture items or room types requires only updating the constants and catalog files.

---

## License

Private project. All rights reserved.

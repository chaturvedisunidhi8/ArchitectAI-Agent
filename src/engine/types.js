/**
 * types.js — JSDoc-only typedefs for the architectural plan pipeline.
 *
 * No runtime code. No TypeScript. No build step.
 * These types document the shapes that flow through the engine so that
 * every consumer agrees on the contract.
 *
 * @module types
 */

/**
 * A convex or concave polygon in clockwise winding order.
 * Each vertex is [x, y] in plan-feet.  The first vertex is implicitly
 * repeated at the end when needed for closure (algorithms close it).
 *
 * @typedef {[number, number][]} Polygon
 */

/**
 * The building envelope.  Always a polygon — currently always a rectangle,
 * but the engine should never assume more than polygon.
 *
 * @typedef {Object} Footprint
 * @property {Polygon} polygon  - Outer boundary in plan-feet.
 * @property {number}  width    - Bounding-box width  (convenience, derived).
 * @property {number}  height   - Bounding-box height (convenience, derived).
 */

/**
 * A single room cell — the atomic unit of the floor plan.
 *
 * `polygon` tiles the footprint exactly (zero gaps, zero overlaps).
 * `x`, `y`, `w`, `h` are derived bounding-box accessors kept in sync
 * so that legacy consumers that read rectangles keep working.
 *
 * @typedef {Object} RoomCell
 * @property {string}   id           - Stable unique id, e.g. "bedroom_1".
 * @property {string}   roomType     - Type key from ROOM_TYPES, e.g. "bedroom".
 * @property {string}   label        - Human-readable name, e.g. "Bedroom 1".
 * @property {Polygon}  polygon      - Cell boundary.  For rectangular cells
 *                                     this is a 4-vertex rect; for L/T shapes
 *                                     it has 6+ vertices.
 * @property {number}   targetArea   - Requested area in sqft.
 * @property {number}   actualArea   - Area of polygon in sqft (computed).
 * @property {[number, number]} centroid - Polygon centroid (computed).
 * @property {string}   color        - Hex fill colour from ROOM_TYPES.
 * @property {number}   aspectTarget - Desired bounding-box w/h ratio.
 *
 * --- Derived bbox accessors (getters, never set directly) ---
 * @property {number}   x  - Bounding-box left.
 * @property {number}   y  - Bounding-box top.
 * @property {number}   w  - Bounding-box width.
 * @property {number}   h  - Bounding-box height.
 *
 * --- Optional ---
 * @property {string}   [floorType]  - Theme override: 'wood'|'tile'|etc.
 * @property {string}   [parentId]   - Slicing-tree parent node id.
 */

/**
 * A single wall segment with thickness and topology.
 *
 * @typedef {Object} WallSegment
 * @property {string} id              - Stable unique id, e.g. "wall_0".
 * @property {[number, number]} start - Start point [x, y].
 * @property {[number, number]} end   - End point   [x, y].
 * @property {number} thickness       - Wall thickness in feet.
 * @property {'exterior'|'interior'} kind - Wall classification.
 * @property {string|null} leftCellId  - Room on the left  (or null for exterior).
 * @property {string|null} rightCellId - Room on the right (or null for exterior).
 */

/**
 * A parametric opening (door, window, or archway) anchored to a wall.
 *
 * Coordinates are stored as `wallId + offsetAlongWall` so that the opening
 * survives re-layouts.  Absolute `x`, `y`, `horizontal` are derived and
 * kept for backward-compatible consumers.
 *
 * @typedef {Object} Opening
 * @property {string}  id              - Stable unique id.
 * @property {string}  wallId          - Parent WallSegment id.
 * @property {number}  offsetAlongWall - Distance from wall start to opening start.
 * @property {number}  width           - Opening width in feet.
 * @property {'door'|'window'|'archway'} kind - Opening type.
 * @property {'in'|'out'|'none'} swingDirection - Door swing (irrelevant for windows).
 * @property {string}  roomId          - Room this opening primarily serves.
 *
 * --- Derived absolute coords (backward-compatible) ---
 * @property {number}  x               - World X position.
 * @property {number}  y               - World Y position.
 * @property {boolean} horizontal      - True if opening runs along X axis.
 * @property {string}  side            - Which wall side of the room ('top'|'bottom'|'left'|'right').
 */

/**
 * A furniture placement record.
 *
 * @typedef {Object} FurniturePlacement
 * @property {string} id       - Unique instance id.
 * @property {string} kind     - Catalog key, e.g. "bed", "sofa", "sink".
 * @property {string} cellId   - RoomCell id this item belongs to.
 * @property {number} x        - World X position.
 * @property {number} y        - World Y position.
 * @property {number} rot      - Rotation in radians.
 * @property {number} scale    - Uniform scale factor.
 * @property {string|null} color - Override colour or null for catalog default.
 */

/**
 * The complete layout state stored in React state and localStorage.
 *
 * @typedef {Object} Layout
 * @property {Footprint}          footprint    - Building envelope.
 * @property {RoomCell[]}         rooms        - Tiling room cells.
 * @property {WallSegment[]}      walls        - Derived wall graph.
 * @property {Opening[]}          doors        - Door openings.
 * @property {Opening[]}          windows      - Window openings.
 * @property {FurniturePlacement[]} furnishings - Furniture.
 * @property {number}             seed         - PRNG seed for this layout.
 * @property {boolean}            [isCustom]   - True for user-edited layouts.
 * @property {Object}             [slicingTree] - The slicing tree (for CustomLayoutBuilder).
 *
 * --- Legacy compatibility (derived) ---
 * @property {{width:number, height:number}} boundary - Derived from footprint.
 */

# Multiple Racks and Custom Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Several racks of any size (1–60U) on one screen, laid out side by side or stacked, with drag between racks.

**Architecture:** `state.racks = [{ id, name, size, slots }]` replaces `rackName/rackSize/slots`; devices stay one global map. The existing helpers keep reading `state.slots`/`state.rackSize`: they get a per-rack *view* (`rackView`) and the reducer writes the view's slots back into that rack. Only cross-rack drag needs a new planner.

**Tech Stack:** React 19, Vite 8, Vitest 5. Tests: `npm test`.

**Spec:** `docs/plans/2026-11-17-multi-rack-design.md`

## Global Constraints

- Rack size: integer 1–60 (`MAX_RACK = 60`); `RACK_SIZES` is deleted.
- `layout`: `"side"` (default) or `"stack"`, saved in state.
- A device is in at most one rack and never spans two.
- A group lives in one rack.
- The last rack cannot be removed. A save with no usable racks loads as one default 12U rack named "Rack 1".
- Old saves (`rackName/rackSize/slots`, storage key `rackitect_v1`) load as one rack with nothing lost. Keep the storage key.
- One `powerCap` for all racks.

## Review Focus

- An old localStorage save with devices and a shelf loads into one rack unchanged → Task 1 test `migrates an old single-rack save`.
- Junk sizes ("abc", 0, 999, 12.5) → clamped to 1–60 and rounded, never NaN → Task 1 test `clamps rack sizes`, Task 2 test `SET_RACK_SIZE clamps`.
- Removing a rack that holds a shelf with items → those devices and the selection go, undo brings all back → Task 2 test `REMOVE_RACK`.
- A cross-rack group drag that doesn't fit → nothing changes in either rack → Task 3 test `refuses a group that does not fit`.
- Undo after a cross-rack move restores both racks in one step → Task 2 test `MOVE_DEVICES across racks`.

---

### Task 1: Rack model, view helpers, and loading

**Files:**
- Create: `src/state/racks.js`
- Modify: `src/data/constants.js` (drop `RACK_SIZES`, add `MAX_RACK = 60`)
- Modify: `src/state/helpers.js` (`DEFAULT_STATE`, `normalizeDevice` callers, `normalizeLib`, `normalizeState`)
- Test: `src/state/racks.test.js`; update `src/state/appState.test.js` normalizeState tests

**Interfaces:**
- Produces (in `racks.js`):
  - `mkRack(name: string, size: number) → { id, name, size, slots }` (id from `uid()`, `size` slots of `mkSlot()`)
  - `clampSize(n: any) → int 1..60 | null` (null when not a finite number; rounds)
  - `rackView(state, rackId) → { ...state, slots, rackSize } | null`
  - `withRackSlots(state, rackId, slots) → state` (replaces that rack's slots, strips `slots/rackSize` keys if present)
  - `rackOf(state, deviceId) → rackId | null` (rack-placed devices only; shelved items → null)
  - `firstFreeSpot(state, dev) → { rackId, row } | null` (first rack in order, first row via `findFirstSlot`)
- `DEFAULT_STATE` gains `racks: [mkRack("Rack 1", 12)]`, `layout: "side"`; loses `rackName/rackSize/slots`.

- [ ] **Step 1: Write failing tests** in `src/state/racks.test.js`:
  - `clamps rack sizes`: `clampSize("20")===20`, `clampSize(0)===1`, `clampSize(999)===60`, `clampSize(12.5)===13`, `clampSize("abc")===null`.
  - `migrates an old single-rack save`: `normalizeState({ rackName:"Lab", rackSize:20, slots:[…a 1U device at row 3, a shelf with one item at row 0…], devices:{…} })` → `racks.length===1`, `racks[0].name==="Lab"`, `racks[0].size===20`, the device at `findRow(racks[0].slots,id)===3`, shelf item kept; no `slots`/`rackSize` keys on the result.
  - `loads several racks and the layout`: two racks (20U, 12U) each with a device → both kept in their racks; `layout:"stack"` kept; `layout:"bogus"` → `"side"`.
  - `a device id placed in two racks is kept only in the first`.
  - `no usable racks loads one default 12U rack`: `racks: []` and `racks: "x"` → one rack, size 12, name "Rack 1".
  - `rackView / withRackSlots / rackOf / firstFreeSpot` round-trip: full first rack → `firstFreeSpot` returns the second rack.
- [ ] **Step 2:** `npm test` → new tests fail (module missing).
- [ ] **Step 3: Implement.** In `normalizeState`, move the slot-parsing loop into `normalizeSlots(rawSlots, size, devices, placedIds) → slots` (same checks as today; `placedIds` is shared across racks so duplicates drop). Old shape = `raw.racks` absent → treat as `[{ name: raw.rackName, size: raw.rackSize, slots: raw.slots }]`. Rack id: keep a unique string id, else `uid()`. Device `uH` clamp uses `MAX_RACK`; `normalizeLib` likewise. Bad size → 12.
- [ ] **Step 4:** Update the existing `normalizeState` tests in `appState.test.js` to read `racks[0].slots`/`racks[0].size` (the `rackSize: 999` case now clamps to 60, not 12). `npm test` → racks + normalize tests pass (reducer tests may still fail until Task 2).
- [ ] **Step 5: Commit** `feat: rack list model and old-save migration`

### Task 2: Reducer on racks

**Files:**
- Modify: `src/state/AppContext.jsx` (`baseReducer`, `rebuildPlacedDevices`, `mergeKey`)
- Test: `src/state/appState.test.js`

**Interfaces:**
- Consumes: Task 1 `rackView`, `withRackSlots`, `rackOf`, `clampSize`, `mkRack`.
- Produces — actions (all others unchanged):
  - `PLACE_DEVICE { rackId, device, rowIndex }`, `INSERT_DEVICE { rackId, … }`, `MOVE_SHELF_ITEM_TO_RACK { rackId, … }` — unknown `rackId` → unchanged state.
  - `MOVE_DEVICES { rackId, moves }` — plans in the target rack's view; on success the moved ids are removed from every other rack. Same action serves same-rack and cross-rack moves.
  - `DELETE_DEVICE`, `MOVE_DEVICE_TO_SHELF`, `SELECT_DEVICE` — rack found via `rackOf`.
  - `GROUP_DEVICES` — refused (unchanged state) unless all ids share one `rackOf`.
  - `SET_RACK_NAME { rackId, name }`, `SET_RACK_SIZE { rackId, newSize }` (clamped; drops what no longer fits, as today).
  - `ADD_RACK` → appends `mkRack("Rack N", 12)` (N = racks.length + 1).
  - `REMOVE_RACK { rackId }` → refused if it is the last rack; deletes the rack and its devices.
  - `SET_LAYOUT { layout }` → `"side" | "stack"`, anything else ignored.
  - `CLEAR_RACK` → empties every rack, keeps names and sizes.
  - `mergeKey`: `SET_RACK_NAME` merges per `rackId`.

- [ ] **Step 1:** Add a test helper `R = (s, i=0) => s.racks[i]` and change `place()` to pass `rackId: state.racks[0].id`; replace `state.slots`/`rackSize` reads in existing tests. Add failing tests:
  - `MOVE_DEVICES across racks`: device in rack A row 0 → `MOVE_DEVICES { rackId: B, moves:[{id,row:2}] }` → gone from A, at row 2 in B; one `UNDO` restores A and B.
  - `SET_RACK_SIZE clamps`: `newSize: 999` → 60; `newSize: "abc"` → unchanged.
  - `REMOVE_RACK`: removing rack B (holds a shelf with an item, selected) drops the shelf, clears `selId/selIds`; `UNDO` restores it; removing the only rack is a no-op.
  - `GROUP_DEVICES refuses ids in two racks`.
  - `CLEAR_RACK keeps racks`: two racks with devices → both empty, names/sizes kept.
  - `SET_LAYOUT` accepts `"stack"`, ignores `"diagonal"`.
- [ ] **Step 2:** `npm test` → new tests fail.
- [ ] **Step 3: Implement** a private `onRack(state, rackId, fn)` that builds the view, runs `fn(view)`, and writes the slots back (returning `state` itself when `fn` returned the view unchanged, so history skips no-ops). Wrap the existing case bodies with it instead of rewriting them.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5: Commit** `feat: reducer works per rack, add/remove racks, layout`

### Task 3: Cross-rack drop planner

**Files:**
- Modify: `src/state/racks.js`
- Test: `src/state/racks.test.js`

**Interfaces:**
- Consumes: `groupMembers`, `groupMoves`, `clampDropRow`, `insertMoves`, `planMoves` from `helpers.js`.
- Produces: `crossRackPlan(state, fromRackId, toRackId, dev, row) → { kind: "move"|"insert"|"insertUp", moves, row } | null`.
  `state` may be an `asSelGroup` state. Moves = the device's group (members in the source rack) at their source offsets, anchored at `row` clamped so the whole block fits the target (`clampDropRow` on `{ ...sourceView, rackSize: target.size }`). Tries plain move, then `insertMoves` down, then up, all checked with `planMoves(targetView, …)`.

- [ ] **Step 1: Failing tests:**
  - `moves a single device into an empty spot in another rack`.
  - `moves a group as one block keeping offsets` (1U at row 0 + 2U at row 1 in A → anchor row 5 in B → rows 5 and 6).
  - `inserts and pushes target devices down when the row is taken`.
  - `refuses a group that does not fit` → `null`, and the state is unchanged.
- [ ] **Step 2:** `npm test` → fail. **Step 3:** implement. **Step 4:** `npm test` → pass.
- [ ] **Step 5: Commit** `feat: plan drops from one rack into another`

### Task 4: Screen

**Files:**
- Modify: `src/components/RackCanvas.jsx`, `Toolbar.jsx`, `LibraryPanel.jsx`, `PropertiesPanel.jsx`, `src/App.css`, `src/state/UIContext.jsx` (drag shape comment)

**Interfaces:**
- Consumes: all of the above.
- Drag shape for rack drags gains `fromRackId`.

- [ ] **Step 1: `RackCanvas`** becomes the container: keyboard shortcuts (nudge uses `rackView(state, rackOf(state, selIds[0]))` and dispatches `MOVE_DEVICES` with that `rackId`; `g` toasts "Groups must be in one rack" when the ids span racks), and a `.racks` wrapper with class `is-side`/`is-stack` mapping `state.racks` to a new `RackPanel({ rack })` component holding today's per-rack drag/drop, ghosts, rows and U column, all computed on `rackView(state, rack.id)`. In `planFor`, a rack drag whose `fromRackId !== rack.id` uses `crossRackPlan`; drops dispatch `MOVE_DEVICES { rackId: rack.id, moves }`. A multi-selection is grouped with `asSelGroup` on the source rack view, so only its members in that rack move. Lib and shelf drops pass `rackId`.
- [ ] **Step 2: Rack header** in `RackPanel`: name input (`SET_RACK_NAME`), size `<input type="number" min=1 max=60>` with local draft state, applied on Enter or blur via the existing shrink-confirm logic moved from `Toolbar.handleSizeChange` (names what gets removed); a remove button disabled when `state.racks.length === 1`, confirming when the rack holds devices.
- [ ] **Step 3: Toolbar:** drop name input and size select; add "+ Rack" (`ADD_RACK`) and a two-button layout toggle (`SET_LAYOUT`, `aria-pressed`). `document.title` and export filename use `state.racks[0].name`; the import confirm says `Load "<first rack name>"…`. "Clear rack" → "Clear all".
- [ ] **Step 4: LibraryPanel** quick-add uses `firstFreeSpot`; toast `"<name> added to <rack name> at U<row+1>"`, or "No space in any rack". **PropertiesPanel** summary: one Name/Size/Used/Free block per rack (`rackSummary(rackView(...))`), power once; device list shows `<rack name> · U<n>`.
- [ ] **Step 5: CSS:** `.racks.is-side { display:flex; gap; overflow-x:auto }`, `.racks.is-stack { flex-direction:column }`; racks align at the top; phone width stays usable.
- [ ] **Step 6: Verify:** `npm test` and `npm run build` pass. In the browser (`npm run dev`): add a 20U and a 12U rack, type `20` in a size box (no flicker to 2U), shrink with a device in the way (confirm names it), drag a device and a group between racks, toggle layout, reload (persists), import an old export (one rack).
- [ ] **Step 7: Commit** `feat: multiple racks on screen, side by side or stacked`

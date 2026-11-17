# Multiple racks and custom sizes — design

## Why

Luca owns a 20U and a 12U rack. Today the app shows one rack, and only the sizes 4/8/12/16/24/42U.
He wants to plan both racks on one screen and type any size.

## Goals

- Any number of racks on one screen. Each has its own name, size and rows.
- A toolbar toggle: racks **side by side** (left to right) or **stacked** (top to bottom). Saved with the layout.
- Rack size is a typed number, 1–60U, for every rack.
- Add a rack, remove a rack (with confirm if it holds devices).
- Drag devices from the library into any rack, and drag placed devices between racks.
- Old saves and exports load as one rack, with nothing lost.

## Non-goals

- Cables or links between racks.
- Per-rack power caps. One power cap stays, for the whole setup (my call: it is one power budget in practice).
- Reordering racks by drag. New racks are added at the end.

## Anti-goals

- A device that spans two racks. Each rack is separate; a device never crosses the edge.
- Losing devices when an old save loads.

## Approaches

- **A. A real list of racks (picked by Luca).** `state.racks = [{ id, name, size, slots }]`, devices stay one global map. Clean model, matches "separate racks on one screen".
- **B. One long rack with dividers.** Less save-format change, but every move/insert must respect section edges, and side-by-side drawing has to slice one array. Rejected: harder to get right at the edges.

## Data

```
state = {
  racks: [{ id, name, size, slots }],   // replaces rackName, rackSize, slots
  layout: "side" | "stack",             // default "side"
  powerCap, devices, selId, selIds, libOverrides, customLib  // unchanged
}
```

- `normalizeState` accepts the old shape (`rackName/rackSize/slots`) and turns it into one rack.
- Sizes are clamped to 1–60 (`RACK_SIZES` list goes away; a `MAX_RACK` constant replaces it).
- A device id is placed in at most one rack.

## How the existing code keeps working (my call)

The helpers (`canPlace`, `dropPlan`, `insertPlan`, `planMoves`, `nudgePlan`, …) read `state.slots` and `state.rackSize`.
Rather than rewrite them, a small `rackView(state, rackId)` returns `{ ...state, slots, rackSize }` for that rack, and the reducer writes the new `slots` back into that rack.
Actions that place or move gain a `rackId`.

## Moves between racks (my call)

- Dragging a device (or its group) into another rack: remove it from the source rack, then plan the drop in the target rack. If it does not fit, nothing changes (same as today).
- Keyboard nudges stay inside the device's own rack.
- A group always lives in one rack. Grouping a selection that spans racks is refused (toast). Dragging a group into another rack moves the whole group as one block, or nothing if it does not fit.
- A multi-selection spread across racks: dragging moves only what is in the dragged item's rack.

## Screen

- `RackCanvas` renders one rack card per rack in a flex container; the toggle flips its direction. Side by side scrolls sideways if racks do not fit.
- Each rack card header: name (editable), size (number box), remove button.
- Toolbar: "+ Rack" button, layout toggle; the size dropdown moves into each rack header.
- Properties panel with nothing selected: list each rack's used/free U; total power as today.
- "Clear rack" becomes clear all racks: racks keep their names and sizes, only devices go (keeps today's confirm).
- The size box applies on Enter or blur, not per keystroke (typing "20" must not pass through "2"). If the new size would drop devices, confirm first and name how many.
- The last rack cannot be removed (button disabled). A save with no usable racks loads as one default 12U rack.

## Left to the builder

- Exact styling of the rack header and toggle, within the existing CSS.
- Test coverage: old-save migration, cross-rack move, size clamp, resize that drops devices, remove rack.

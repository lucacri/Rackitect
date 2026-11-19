import { MAX_RACK } from "../data/constants";
import {
	clampDropRow,
	findFirstSlot,
	findRow,
	groupMembers,
	groupMoves,
	insertMoves,
	mkSlot,
	nudgePlan,
	planMoves,
	uid,
} from "./helpers";

export function mkRack(name, size) {
	return { id: uid(), name, size, slots: Array.from({ length: size }, mkSlot) };
}

// Rack size as an int 1..MAX_RACK, or null when it is not a number
export function clampSize(n) {
	if (n === null || n === "" || typeof n === "boolean") return null;
	const v = Number(n);
	return Number.isFinite(v) ? Math.min(MAX_RACK, Math.max(1, Math.round(v))) : null;
}

// The state as the single-rack helpers expect it (slots, rackSize) for one rack
export function rackView(state, rackId) {
	const rack = state.racks.find((r) => r.id === rackId);
	return rack ? { ...state, slots: rack.slots, rackSize: rack.size } : null;
}

// Write a view's slots back into its rack, dropping the view-only keys
export function withRackSlots(state, rackId, slots) {
	const { slots: _s, rackSize: _r, ...rest } = state;
	return {
		...rest,
		racks: state.racks.map((r) => (r.id === rackId ? { ...r, slots } : r)),
	};
}

export function rackOf(state, deviceId) {
	return state.racks.find((r) => findRow(r.slots, deviceId) >= 0)?.id ?? null;
}

export function firstFreeSpot(state, dev) {
	for (const r of state.racks) {
		const row = findFirstSlot(rackView(state, r.id), dev);
		if (row >= 0) return { rackId: r.id, row };
	}
	return null;
}

/**
 * What happens if rack device `dev` (with its group, members in the source rack)
 * is dragged from one rack and dropped with its top on `row` in another. The block
 * keeps its offsets and is clamped to fit the target. Tries a plain move, then
 * inserting and pushing target devices down, then up.
 * Returns { kind: "move"|"insert"|"insertUp", moves, row } or null.
 */
export function crossRackPlan(state, fromRackId, toRackId, dev, row) {
	const src = rackView(state, fromRackId);
	const dst = rackView(state, toRackId);
	if (!src || !dst || findRow(src.slots, dev.id) < 0) return null;
	const grouped = groupMembers(src, dev.groupId).length > 1;
	const r = clampDropRow({ ...src, rackSize: dst.rackSize }, dev, row);
	const at = (top) => (grouped ? groupMoves(src, dev.id, top) : [{ id: dev.id, row: top }]);
	const moves = at(r);
	if (planMoves(dst, moves)) return { kind: "move", moves, row: r };
	// like dropPlan: on a multi-U device's lower row, also try inserting at its top
	const span = dst.slots[r]?.spanOf;
	for (const top of span ? [r, r - span.offset] : [r]) {
		const down = insertMoves(dst, at(top));
		if (planMoves(dst, down)) return { kind: "insert", moves: down, row: top };
	}
	const up = insertMoves(dst, moves, true);
	return planMoves(dst, up) ? { kind: "insertUp", moves: up, row: r } : null;
}

// Devices lost by removing this rack: its rack-mounted ones plus everything on their shelves
export function rackDeviceCount(state, rackId) {
	const view = rackView(state, rackId);
	if (!view) return 0;
	return view.slots
		.flatMap((sl) => sl.items)
		.reduce((sum, it) => sum + 1 + (state.devices[it.id]?.shelved?.length ?? 0), 0);
}

// Devices in this rack that would be dropped by resizing it to `newSize`
export function shrinkLoss(state, rackId, newSize) {
	const view = rackView(state, rackId);
	if (!view) return [];
	return Object.values(state.devices).filter((d) => {
		const r = findRow(view.slots, d.id);
		return r >= 0 && r + d.uH > newSize;
	});
}

// Move the selected devices one row (delta -1 up, +1 down), inside the first one's rack
export function nudgeAction(state, ids, delta) {
	const rackId = rackOf(state, ids[0]);
	const view = rackView(state, rackId);
	if (!view) return null;
	const plan = nudgePlan(view, ids.filter((id) => findRow(view.slots, id) >= 0), delta);
	return plan ? { type: "MOVE_DEVICES", rackId, moves: plan.moves } : null;
}

import { MAX_RACK } from "../data/constants";
import { findFirstSlot, findRow, mkSlot, uid } from "./helpers";

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

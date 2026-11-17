import { CAT_COLORS, MAX_U, PORT_LBL, RACK_SIZES } from "../data/constants";
import BUILTIN_LIBRARY from "../data/library";

let _uid = 0;
export function uid() {
	return "d" + Date.now().toString(36) + ++_uid;
}

export function mkSlot() {
	return { items: [], spanOf: null };
}

const DEFAULT_STATE = {
	rackName: "Rack 1",
	rackSize: 12,
	powerCap: 2000,
	devices: {},
	slots: Array.from({ length: 12 }, mkSlot),
	selId: null,
	selIds: [],
	libOverrides: {},
	customLib: [],
};

function numberInRange(value, fallback, min, max) {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function normalizePower(pwr) {
	const type = pwr?.type === "outlet" ? "cord" : pwr?.type;
	return {
		type: ["cord", "brick", "poe", "usb", "passive"].includes(type)
			? type
			: "passive",
		conn: typeof pwr?.conn === "string" ? pwr.conn : "",
		w: numberInRange(pwr?.w, 0, 0, 100000),
	};
}

function normalizePorts(ports) {
	if (!Array.isArray(ports)) return [];
	return ports.map((port) => ({
		t: typeof port?.t === "string" ? port.t : "ethernet",
		n: numberInRange(port?.n, 1, 1, 999),
		s: typeof port?.s === "string" ? port.s : String(port?.s ?? ""),
	}));
}

function normalizeShelvedItems(shelfId, shelved) {
	if (!Array.isArray(shelved)) return [];
	const shelf = { id: shelfId, cat: "shelf", shelved: [] };
	const seen = new Set();

	for (const [index, item] of shelved.entries()) {
		const id = String(item?.id ?? `${shelfId}-shelf-${index}`);
		if (seen.has(id)) continue;
		const normalized = normalizeDevice(id, item, 1);
		delete normalized?.groupId; // shelved items are never grouped
		if (!normalized || !canPlaceOnShelf(shelf, normalized)) continue;
		shelf.shelved.push(normalized);
		seen.add(id);
	}

	return shelf.shelved;
}

function normalizeDevice(id, dev, rackSize) {
	if (!dev || typeof dev !== "object") return null;
	const cat = CAT_COLORS[dev.cat] ? dev.cat : "custom";
	const normalized = {
		id,
		libId: typeof dev.libId === "string" ? dev.libId : id,
		name:
			typeof dev.name === "string" && dev.name.trim()
				? dev.name
				: "Untitled device",
		cat,
		uH: numberInRange(dev.uH, 1, 1, rackSize),
		u: numberInRange(dev.u, MAX_U, 1, MAX_U),
		pwr: normalizePower(dev.pwr),
		ports: normalizePorts(dev.ports),
		notes: typeof dev.notes === "string" ? dev.notes : "",
		...(typeof dev.groupId === "string" ? { groupId: dev.groupId } : {}),
	};
	if (cat === "shelf") {
		normalized.shelved = normalizeShelvedItems(id, dev.shelved);
	}
	return normalized;
}

export function normalizeState(raw) {
	if (!raw || typeof raw !== "object") return DEFAULT_STATE;

	const rackSize = RACK_SIZES.includes(Number(raw.rackSize))
		? Number(raw.rackSize)
		: DEFAULT_STATE.rackSize;
	const devices = Object.fromEntries(
		Object.entries(
			raw.devices && typeof raw.devices === "object" ? raw.devices : {},
		)
			.map(([id, dev]) => [id, normalizeDevice(id, dev, rackSize)])
			.filter(([, dev]) => dev),
	);

	const rawSlots = Array.isArray(raw.slots) ? raw.slots : [];
	const slots = Array.from({ length: rackSize }, mkSlot);
	const placedIds = new Set();

	for (let index = 0; index < rackSize; index++) {
		const rawSlot = rawSlots[index];
		if (!rawSlot || typeof rawSlot !== "object" || rawSlot.spanOf) continue;
		if (!Array.isArray(rawSlot.items)) continue;

		let usedU = 0;
		for (const item of rawSlot.items) {
			const device = devices[item?.id];
			if (!device || placedIds.has(device.id)) continue;
			const u = numberInRange(item.u, device.u, 1, MAX_U);
			if (usedU + u > MAX_U) continue;
			if (index + device.uH > rackSize) continue;

			let validSpan = true;
			for (let offset = 1; offset < device.uH; offset++) {
				const spanSlot = rawSlots[index + offset];
				if (
					!spanSlot ||
					typeof spanSlot !== "object" ||
					!spanSlot.spanOf ||
					spanSlot.spanOf.id !== device.id ||
					Number(spanSlot.spanOf.offset) !== offset
				) {
					validSpan = false;
					break;
				}
			}
			if (!validSpan) continue;

			slots[index].items.push({ id: device.id, u });
			for (let offset = 1; offset < device.uH; offset++) {
				slots[index + offset] = {
					items: [],
					spanOf: { id: device.id, offset },
				};
			}
			placedIds.add(device.id);
			usedU += u;
		}
	}

	const placedDevices = Object.fromEntries(
		Object.entries(devices).filter(([id]) => placedIds.has(id)),
	);
	const globalIds = new Set(Object.keys(placedDevices));
	const globallyUniqueDevices = Object.fromEntries(
		Object.entries(placedDevices).map(([id, dev]) => {
			if (dev.cat !== "shelf") return [id, dev];
			const shelf = { ...dev, shelved: [] };
			for (const item of dev.shelved ?? []) {
				if (globalIds.has(item.id)) continue;
				if (!canPlaceOnShelf(shelf, item)) continue;
				shelf.shelved.push(item);
				globalIds.add(item.id);
			}
			return [id, shelf];
		}),
	);

	return {
		...DEFAULT_STATE,
		rackName:
			typeof raw.rackName === "string" && raw.rackName.trim()
				? raw.rackName
				: DEFAULT_STATE.rackName,
		rackSize,
		powerCap: numberInRange(raw.powerCap, DEFAULT_STATE.powerCap, 0, 1000000),
		devices: globallyUniqueDevices,
		slots,
		selId:
			typeof raw.selId === "string" && globallyUniqueDevices[raw.selId]
				? raw.selId
				: null,
		libOverrides:
			raw.libOverrides && typeof raw.libOverrides === "object"
				? raw.libOverrides
				: {},
		customLib: Array.isArray(raw.customLib) ? raw.customLib : [],
	};
}

export function esc(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function getEffectiveLib(state) {
	return [
		...BUILTIN_LIBRARY.map((lib) =>
			state.libOverrides?.[lib.libId]
				? { ...lib, ...state.libOverrides[lib.libId] }
				: lib,
		),
		...(state.customLib ?? []),
	];
}

export function deviceFromLib(lib) {
	return {
		id: uid(),
		libId: lib.libId,
		name: lib.name,
		cat: lib.cat,
		uH: lib.uH,
		u: lib.u,
		pwr: { ...lib.pwr },
		ports: lib.ports.map((p) => ({ ...p })),
		notes: "",
		...(lib.cat === "shelf" ? { shelved: [] } : {}),
	};
}

// ── Placement validation ──────────────────────────────────────────────────────

function rowFreeUnits(slots, ri, ignoreId) {
	const slot = slots[ri];
	if (!slot) return 0;
	if (slot.spanOf) return slot.spanOf.id === ignoreId ? MAX_U : 0;
	return (
		MAX_U -
		slot.items.filter((it) => it.id !== ignoreId).reduce((s, it) => s + it.u, 0)
	);
}

function rowHasFullDevice(slots, ri, ignoreId) {
	const slot = slots[ri];
	if (!slot) return true;
	return slot.items
		.filter((it) => it.id !== ignoreId)
		.some((it) => it.u === MAX_U);
}

// Returns true if `dev` fits on `shelf` (shelves only hold single-U items)
export function canPlaceOnShelf(shelf, dev, ignoreId = null) {
	if (!shelf || shelf.cat !== "shelf") return false;
	if (dev.uH > 1) return false; // multi-U can't sit on a shelf
	if (dev.cat === "shelf") return false; // no nested shelves
	const used = (shelf.shelved ?? [])
		.filter((it) => it.id !== ignoreId)
		.reduce((s, it) => s + it.u, 0);
	return used + dev.u <= MAX_U;
}

export function canPlace(slots, rackSize, ri, dev, ignoreId = null) {
	if (ri < 0 || ri + dev.uH > rackSize) return false;
	for (let i = 0; i < dev.uH; i++) {
		const slot = slots[ri + i];
		if (!slot) return false;
		if (slot.spanOf && slot.spanOf.id !== ignoreId) return false;
		if (rowFreeUnits(slots, ri + i, ignoreId) < dev.u) return false;
		if (rowHasFullDevice(slots, ri + i, ignoreId)) return false;
	}
	return true;
}

export function findRow(slots, id) {
	for (let i = 0; i < slots.length; i++) {
		if (slots[i].items.some((it) => it.id === id)) return i;
	}
	return -1;
}

export function findFirstSlot(state, dev) {
	for (let i = 0; i < state.rackSize; i++) {
		if (canPlace(state.slots, state.rackSize, i, dev)) return i;
	}
	return -1;
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function pwrBadge(pwr) {
	if (!pwr || pwr.type === "passive") return "";
	if (pwr.type === "poe") return "PoE";
	if (pwr.type === "brick") return "Brick";
	return pwr.conn || pwr.type;
}

export function portSummary(ports) {
	if (!ports?.length) return "";
	const p = ports[0];
	return `${p.n}×${PORT_LBL[p.t] ?? p.t}`;
}

export function rackSummary(state) {
	let uU = 0,
		w = 0;
	for (const dev of Object.values(state.devices)) {
		uU += dev.uH;
		w += dev.pwr?.w ?? 0;
		// Also count power draw of items sitting on shelves
		for (const it of dev.shelved ?? []) {
			w += it.pwr?.w ?? 0;
		}
	}
	const pct =
		state.powerCap > 0
			? Math.min(100, Math.round((w / state.powerCap) * 100))
			: 0;
	return { uU, freeU: state.rackSize - uU, w, pct };
}

// ── Slot mutation (pure) ──────────────────────────────────────────────────────

export function removeDeviceFromSlots(slots, deviceId) {
	return slots.map((s) => ({
		...s,
		items: s.items.filter((it) => it.id !== deviceId),
		spanOf: s.spanOf?.id === deviceId ? null : s.spanOf,
	}));
}

export function placeDeviceInSlots(slots, device, rowIndex) {
	const next = slots.map((s) => ({ ...s, items: [...s.items] }));
	next[rowIndex].items.push({ id: device.id, u: device.u });
	for (let i = 1; i < device.uH; i++) {
		next[rowIndex + i] = {
			...next[rowIndex + i],
			spanOf: { id: device.id, offset: i },
		};
	}
	return next;
}

// ── Multi-device moves (swap, group) ──────────────────────────────────────────

// Lift every device in `moves` ([{ id, row }]), then re-place each at its new row.
// Returns the new slots, or null if any device would not fit.
export function planMoves(state, moves) {
	let slots = state.slots;
	for (const { id } of moves) slots = removeDeviceFromSlots(slots, id);
	for (const { id, row } of moves) {
		const dev = state.devices[id];
		if (!dev || !canPlace(slots, state.rackSize, row, dev)) return null;
		slots = placeDeviceInSlots(slots, dev, row);
	}
	return slots;
}

// Rack-placed ids sharing `groupId`
export function groupMembers(state, groupId) {
	if (!groupId) return [];
	return Object.values(state.devices)
		.filter((d) => d.groupId === groupId && findRow(state.slots, d.id) >= 0)
		.map((d) => d.id);
}

// Moves that shift a whole group so `anchorId` lands on `toRow`
export function groupMoves(state, anchorId, toRow) {
	const delta = toRow - findRow(state.slots, anchorId);
	return groupMembers(state, state.devices[anchorId]?.groupId).map((id) => ({
		id,
		row: findRow(state.slots, id) + delta,
	}));
}

// Moves that exchange the rows of two rack devices. The lower device takes the
// upper one's top row and the upper one is bottom-aligned to the lower one's old
// extent, so adjacent devices of different heights (1U + 2U) still swap.
export function swapMoves(state, aId, bId) {
	const [top, bot] = [aId, bId]
		.map((id) => ({ id, row: findRow(state.slots, id) }))
		.sort((x, y) => x.row - y.row);
	const h = (id) => state.devices[id]?.uH ?? 1;
	return [
		{ id: bot.id, row: top.row },
		{ id: top.id, row: bot.row + h(bot.id) - h(top.id) },
	];
}

// Stable hue per group so neighbouring groups get distinct colours
export function groupHue(groupId) {
	let h = 0;
	for (const ch of groupId) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

// Selected rack device ids (multi-selection, else the single selection)
export function selectedIds(state) {
	const ids = state.selIds?.length
		? state.selIds
		: state.selId
			? [state.selId]
			: [];
	return ids.filter((id) => state.devices[id]);
}

// Moves that put `moving` ([{ id, row }]) in place and push the devices from the
// insert row down by the moving block's height, only as far as the first free gap
// (so moving a device up reorders instead of leaving a hole).
export function insertMoves(state, moving) {
	const ids = new Set(moving.map((m) => m.id));
	const uH = (id) => state.devices[id]?.uH ?? 1;
	const top = Math.min(...moving.map((m) => m.row));
	const h = Math.max(...moving.map((m) => m.row + uH(m.id))) - top;
	let lifted = state.slots;
	for (const id of ids) lifted = removeDeviceFromSlots(lifted, id);
	const empty = (r) => !lifted[r].spanOf && lifted[r].items.length === 0;
	let gap = state.rackSize; // no gap → push everything (overflow is refused later)
	for (let r = top; r + h <= state.rackSize; r++) {
		if (Array.from({ length: h }, (_, i) => empty(r + i)).every(Boolean)) {
			gap = r;
			break;
		}
	}
	const pushed = Object.keys(state.devices)
		.filter((id) => !ids.has(id))
		.map((id) => ({ id, row: findRow(state.slots, id) }))
		.filter((m) => m.row >= top && m.row < gap)
		.map((m) => ({ ...m, row: m.row + h }));
	return [...pushed, ...moving];
}

// Slots after inserting a not-yet-placed `device` at `row`, or null if it can't go there
export function insertPlan(state, device, row) {
	const s = { ...state, devices: { ...state.devices, [device.id]: device } };
	return planMoves(s, insertMoves(s, [{ id: device.id, row }]));
}

// Moving a block down: the devices it passes over slide up into the space it left.
function pullUpMoves(state, moving) {
	const ids = new Set(moving.map((m) => m.id));
	const uH = (id) => state.devices[id]?.uH ?? 1;
	const top = Math.min(...moving.map((m) => m.row));
	const h = Math.max(...moving.map((m) => m.row + uH(m.id))) - top;
	const oldTop = Math.min(...moving.map((m) => findRow(state.slots, m.id)));
	if (oldTop < 0 || top <= oldTop) return null;
	const pulled = Object.keys(state.devices)
		.filter((id) => !ids.has(id))
		.map((id) => ({ id, row: findRow(state.slots, id) }))
		.filter((m) => m.row >= oldTop + h && m.row < top + h)
		.map((m) => ({ ...m, row: m.row - h }));
	return [...pulled, ...moving];
}

/**
 * What happens if `dev` is dropped with its top on `row`. `dev` may be off the
 * rack (library or shelf item). Grouped rack devices bring their group.
 * Tries, in order: a plain move; when moving down, sliding the passed-over
 * devices up (also one row lower, for landing on the top half of a taller
 * device); inserting and pushing devices down. With `swapWith` it only swaps.
 * Returns { kind: "move"|"reorder"|"insert"|"swap", moves, row } or null.
 */
export function dropPlan(state, dev, row, swapWith = null) {
	const s = state.devices[dev.id]
		? state
		: { ...state, devices: { ...state.devices, [dev.id]: dev } };
	const fromRow = findRow(s.slots, dev.id);
	const grouped = fromRow >= 0 && groupMembers(s, dev.groupId).length > 1;
	const at = (r) => (grouped ? groupMoves(s, dev.id, r) : [{ id: dev.id, row: r }]);
	const fits = (moves) => moves && planMoves(s, moves);

	if (swapWith) {
		if (grouped || fromRow < 0 || swapWith === dev.id) return null;
		if (groupMembers(s, s.devices[swapWith]?.groupId).length > 1) return null;
		const moves = swapMoves(s, dev.id, swapWith);
		return fits(moves) ? { kind: "swap", moves, row } : null;
	}
	if (fits(at(row))) return { kind: "move", moves: at(row), row };
	for (const r of [row, row + 1]) {
		const moves = pullUpMoves(s, at(r));
		if (fits(moves)) return { kind: "reorder", moves, row: r };
	}
	const moves = insertMoves(s, at(row));
	return fits(moves) ? { kind: "insert", moves, row } : null;
}

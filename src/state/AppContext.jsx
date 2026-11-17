import {
	createContext,
	useContext,
	useReducer,
	useEffect,
	useState,
} from "react";
import {
	DEFAULT_STATE,
	canPlace,
	canPlaceOnShelf,
	groupMembers,
	insertPlan,
	keepShelfCat,
	mkSlot,
	normalizeState,
	placeDeviceInSlots,
	planMoves,
	removeDeviceFromSlots,
	uid,
} from "./helpers";

export const INIT = DEFAULT_STATE;

// ── Reducer ───────────────────────────────────────────────────────────────────

function rebuildPlacedDevices(devices, slots, rackSize) {
	let rebuiltSlots = Array.from({ length: rackSize }, mkSlot);
	const keptDevices = {};

	for (let rowIndex = 0; rowIndex < rackSize; rowIndex++) {
		const slot = slots[rowIndex];
		if (!slot || slot.spanOf || !Array.isArray(slot.items)) continue;
		for (const item of slot.items) {
			const device = devices[item.id];
			if (!device || keptDevices[device.id]) continue;
			if (!canPlace(rebuiltSlots, rackSize, rowIndex, device)) continue;
			keptDevices[device.id] = device;
			rebuiltSlots = placeDeviceInSlots(rebuiltSlots, device, rowIndex);
		}
	}

	return { devices: keptDevices, slots: rebuiltSlots };
}

// Drop selection ids and single-member groups left behind by delete, shelve, clear, resize or load
function tidy(state) {
	const live = (id) => !!state.devices[id];
	const selIds = (state.selIds ?? []).filter(live);
	const selId = live(state.selId) ? state.selId : (selIds.at(-1) ?? null);
	const counts = {};
	for (const d of Object.values(state.devices))
		if (d.groupId) counts[d.groupId] = (counts[d.groupId] ?? 0) + 1;
	const lone = Object.values(state.devices).filter(
		(d) => d.groupId && counts[d.groupId] < 2,
	);
	if (
		selIds.length === (state.selIds ?? []).length &&
		selId === state.selId &&
		!lone.length
	)
		return state;
	const devices = { ...state.devices };
	for (const { groupId: _g, ...rest } of lone) devices[rest.id] = rest;
	return { ...state, devices, selId, selIds };
}

export function reducer(state, action) {
	return tidy(baseReducer(state, action));
}

function baseReducer(state, action) {
	switch (action.type) {
		case "LOAD":
			return normalizeState(action.payload);

		case "SET_RACK_NAME":
			return { ...state, rackName: action.name };

		case "SET_RACK_SIZE": {
			const { newSize } = action;
			const resizedSlots = Array.from(
				{ length: newSize },
				(_, i) => state.slots[i] ?? mkSlot(),
			);
			const { devices, slots } = rebuildPlacedDevices(
				state.devices,
				resizedSlots,
				newSize,
			);
			return {
				...state,
				rackSize: newSize,
				devices,
				slots,
				selId: state.selId && devices[state.selId] ? state.selId : null,
			};
		}

		case "SET_POWER_CAP":
			return { ...state, powerCap: action.cap };

		case "PLACE_DEVICE": {
			const { device, rowIndex } = action;
			if (
				!device ||
				state.devices[device.id] ||
				!canPlace(state.slots, state.rackSize, rowIndex, device)
			)
				return state;
			return {
				...state,
				devices: { ...state.devices, [device.id]: device },
				slots: placeDeviceInSlots(state.slots, device, rowIndex),
			};
		}

		case "INSERT_DEVICE": {
			// Place a new device on a full row, pushing the rows below down
			const { device, rowIndex } = action;
			if (!device || state.devices[device.id]) return state;
			const slots = insertPlan(state, device, rowIndex);
			if (!slots) return state;
			return {
				...state,
				devices: { ...state.devices, [device.id]: device },
				slots,
			};
		}

		case "MOVE_DEVICES": {
			// Atomic multi-move (swap, group move): all fit or nothing changes
			const slots = planMoves(state, action.moves ?? []);
			return slots ? { ...state, slots } : state;
		}

		case "GROUP_DEVICES": {
			const ids = (action.ids ?? []).filter((id) => state.devices[id]);
			if (ids.length < 2) return state;
			const groupId = uid();
			const devices = { ...state.devices };
			for (const id of ids) devices[id] = { ...devices[id], groupId };
			return { ...state, devices };
		}

		case "UNGROUP": {
			const devices = Object.fromEntries(
				Object.entries(state.devices).map(([id, dev]) => {
					if (!action.groupId || dev.groupId !== action.groupId)
						return [id, dev];
					const { groupId: _g, ...rest } = dev;
					return [id, rest];
				}),
			);
			return { ...state, devices };
		}

		case "MOVE_DEVICE_TO_SHELF": {
			const { deviceId, shelfId } = action;
			const device = state.devices[deviceId];
			const shelf = state.devices[shelfId];
			if (!device || !canPlaceOnShelf(shelf, device)) return state;
			const devices = { ...state.devices };
			delete devices[deviceId];
			const { groupId: _g, ...loose } = device; // shelved items leave their group
			devices[shelfId] = {
				...shelf,
				shelved: [...(shelf.shelved ?? []), loose],
			};
			return {
				...state,
				devices,
				slots: removeDeviceFromSlots(state.slots, deviceId),
				selId: state.selId === deviceId ? null : state.selId,
			};
		}

		case "MOVE_SHELF_ITEM": {
			const { deviceId, fromShelfId, toShelfId } = action;
			const fromShelf = state.devices[fromShelfId];
			const toShelf = state.devices[toShelfId];
			const device = fromShelf?.shelved?.find((it) => it.id === deviceId);
			if (
				!device ||
				!toShelf ||
				fromShelfId === toShelfId ||
				!canPlaceOnShelf(toShelf, device)
			)
				return state;
			return {
				...state,
				devices: {
					...state.devices,
					[fromShelfId]: {
						...fromShelf,
						shelved: fromShelf.shelved.filter((it) => it.id !== deviceId),
					},
					[toShelfId]: {
						...toShelf,
						shelved: [...(toShelf.shelved ?? []), device],
					},
				},
			};
		}

		case "MOVE_SHELF_ITEM_TO_RACK": {
			const { deviceId, shelfId, rowIndex } = action;
			const shelf = state.devices[shelfId];
			const device = shelf?.shelved?.find((it) => it.id === deviceId);
			if (!device || !canPlace(state.slots, state.rackSize, rowIndex, device))
				return state;
			return {
				...state,
				devices: {
					...state.devices,
					[device.id]: device,
					[shelfId]: {
						...shelf,
						shelved: shelf.shelved.filter((it) => it.id !== deviceId),
					},
				},
				slots: placeDeviceInSlots(state.slots, device, rowIndex),
			};
		}

		case "DELETE_DEVICE": {
			const { deviceId } = action;
			const slots = removeDeviceFromSlots(state.slots, deviceId);
			const devices = { ...state.devices };
			delete devices[deviceId];
			return {
				...state,
				devices,
				slots,
				selId: state.selId === deviceId ? null : state.selId,
				selIds: (state.selIds ?? []).filter((id) => id !== deviceId),
			};
		}

		case "SELECT_DEVICE": {
			const { deviceId, additive } = action;
			if (!deviceId) return { ...state, selId: null, selIds: [] };
			if (additive) {
				const cur = state.selIds?.length
					? state.selIds
					: state.selId
						? [state.selId]
						: [];
				const selIds = cur.includes(deviceId)
					? cur.filter((id) => id !== deviceId)
					: [...cur, deviceId];
				return { ...state, selId: selIds.at(-1) ?? null, selIds };
			}
			const members = groupMembers(state, state.devices[deviceId]?.groupId);
			return {
				...state,
				selId: deviceId,
				selIds: members.length > 1 ? members : [deviceId],
			};
		}

		case "UPDATE_DEVICE": {
			const dev = state.devices[action.deviceId];
			if (!dev) return state;
			const { u: _u, uH: _uH, ...safeFields } = action.fields ?? {};
			const next = { ...dev, ...safeFields };
			next.cat = keepShelfCat(dev, next.cat);
			return {
				...state,
				devices: { ...state.devices, [action.deviceId]: next },
			};
		}

		case "ADD_CUSTOM_LIB":
			return { ...state, customLib: [...state.customLib, action.entry] };

		case "UPDATE_LIB": {
			const { libId, fields, isBuiltin } = action;
			let libOverrides = state.libOverrides;
			let customLib = state.customLib;
			if (isBuiltin) {
				libOverrides = { ...libOverrides, [libId]: fields };
			} else {
				customLib = customLib.map((l) =>
					l.libId === libId ? { ...l, ...fields } : l,
				);
			}
			// Propagate display-only changes to already-placed instances, shelved ones too.
			// Size changes affect future placements only; slots remain the source of placed size.
			const sync = (dev) =>
				dev.libId === libId
					? {
							...dev,
							name: fields.name,
							cat: keepShelfCat(dev, fields.cat),
							pwr: fields.pwr,
							ports: fields.ports,
						}
					: dev;
			const devices = Object.fromEntries(
				Object.entries(state.devices).map(([id, dev]) => {
					const d = sync(dev);
					return [id, d.shelved ? { ...d, shelved: d.shelved.map(sync) } : d];
				}),
			);
			return { ...state, libOverrides, customLib, devices };
		}

		// ── Shelf actions ─────────────────────────────────────────────────────────

		case "PLACE_ON_SHELF": {
			// device: a new device (from the library), not yet in state.devices
			const { shelfId, device } = action;
			const shelf = state.devices[shelfId];
			if (!device || state.devices[device.id] || !canPlaceOnShelf(shelf, device))
				return state;
			return {
				...state,
				devices: {
					...state.devices,
					[shelfId]: { ...shelf, shelved: [...(shelf.shelved ?? []), device] },
				},
			};
		}

		case "REMOVE_FROM_SHELF": {
			// Delete a shelved item without re-placing it
			const { shelfId, deviceId } = action;
			const shelf = state.devices[shelfId];
			if (!shelf) return state;
			return {
				...state,
				devices: {
					...state.devices,
					[shelfId]: {
						...shelf,
						shelved: (shelf.shelved ?? []).filter((it) => it.id !== deviceId),
					},
				},
			};
		}

		case "CLEAR_RACK":
			return {
				...state,
				devices: {},
				slots: Array.from({ length: state.rackSize }, mkSlot),
				selId: null,
				selIds: [],
			};

		default:
			return state;
	}
}

// ── Undo history ──────────────────────────────────────────────────────────────

const HISTORY_CAP = 50;

export const initHistory = (present) => ({
	past: [],
	present,
	future: [],
	lastKey: null,
});

// Typing in a field fires one action per keystroke: merge each run into one undo step
function mergeKey(action) {
	if (action.type === "SET_RACK_NAME" || action.type === "SET_POWER_CAP")
		return action.type;
	if (action.type === "UPDATE_DEVICE") return action.type + action.deviceId;
	return null;
}

// Wraps `reducer` with UNDO / REDO and BATCH (several actions, one undo step).
// Selection changes update the present without an undo step.
export function historyReducer(h, action) {
	if (action.type === "UNDO" || action.type === "REDO") {
		const undo = action.type === "UNDO";
		const from = undo ? h.past : h.future;
		if (!from.length) return h;
		const present = undo ? from.at(-1) : from[0];
		return {
			past: undo ? h.past.slice(0, -1) : [...h.past, h.present],
			present,
			future: undo ? [h.present, ...h.future] : h.future.slice(1),
			lastKey: null,
		};
	}
	const present =
		action.type === "BATCH"
			? action.actions.reduce(reducer, h.present)
			: reducer(h.present, action);
	if (present === h.present) return h;
	if (action.type === "SELECT_DEVICE")
		return { ...h, present };
	const key = mergeKey(action);
	if (key && key === h.lastKey) return { ...h, present, future: [] };
	return {
		past: [...h.past, h.present].slice(-HISTORY_CAP),
		present,
		future: [],
		lastKey: key,
	};
}

const STORAGE_KEY = "rackitect_v1";

// Saved rack, or INIT. An unreadable save is copied aside so the next save can't destroy it.
export function loadSaved() {
	let raw = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
		return raw ? normalizeState(JSON.parse(raw)) : INIT;
	} catch (err) {
		console.error("Rackitect: saved rack unreadable, kept a copy", err);
		try {
			if (raw) localStorage.setItem(`${STORAGE_KEY}_corrupt_${Date.now()}`, raw);
		} catch (_) {}
		return INIT;
	}
}

// ── Context + Provider ────────────────────────────────────────────────────────

const AppContext = createContext(null);

export function AppProvider({ children }) {
	// Load synchronously so the first render (and first save) is the saved rack, never blank INIT
	const [history, dispatch] = useReducer(historyReducer, null, () =>
		initHistory(loadSaved()),
	);
	const state = history.present;
	const [saveError, setSaveError] = useState(false);

	// Persist on every state change
	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
			setSaveError(false);
		} catch (err) {
			console.error("Rackitect: could not save to localStorage", err);
			setSaveError(true);
		}
	}, [state]);

	return (
		<AppContext.Provider
			value={{
				state,
				dispatch,
				canUndo: history.past.length > 0,
				canRedo: history.future.length > 0,
				saveError,
			}}
		>
			{children}
		</AppContext.Provider>
	);
}

export function useApp() {
	return useContext(AppContext);
}

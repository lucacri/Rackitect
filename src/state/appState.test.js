import { describe, expect, it } from "vitest";
import {
	deviceFromLib,
	findRow,
	groupHue,
	mkSlot,
	normalizeState,
	selectedIds,
} from "./helpers";
import { INIT, historyReducer, initHistory, reducer } from "./AppContext";
import { rackView } from "./racks";

const oneU = {
	libId: "server",
	name: "Server",
	cat: "compute",
	uH: 1,
	u: 6,
	pwr: { type: "cord", conn: "C13", w: 100 },
	ports: [],
};

const twoU = { ...oneU, libId: "storage", name: "Storage", uH: 2 };
const shelfLib = {
	libId: "shelf",
	name: "Shelf",
	cat: "shelf",
	uH: 1,
	u: 6,
	pwr: { type: "passive", conn: "", w: 0 },
	ports: [],
};

const R = (s, i = 0) => s.racks[i];
const V = (s, i = 0) => rackView(s, R(s, i).id);
const RID = INIT.racks[0].id;

function place(state, lib, rowIndex, rackId = RID) {
	return reducer(state, {
		type: "PLACE_DEVICE",
		rackId,
		device: deviceFromLib(lib),
		rowIndex,
	});
}

describe("normalizeState", () => {
	it("repairs malformed persisted state and removes dangling slot references", () => {
		const normalized = normalizeState({
			rackName: 42,
			rackSize: 999,
			powerCap: "bad",
			selId: "missing-device",
			devices: {
				ok: {
					id: "ok",
					libId: "ok-lib",
					name: "OK",
					cat: "compute",
					uH: 1,
					u: 6,
					pwr: { type: "outlet", conn: "C13", w: "15" },
					ports: [{ t: "ethernet", n: "2", s: 10 }],
				},
			},
			slots: [
				{
					items: [
						{ id: "ok", u: 6 },
						{ id: "missing-device", u: 6 },
					],
					spanOf: null,
				},
				{ items: "not-array", spanOf: { id: "missing-device", offset: 1 } },
			],
		});

		const rack = normalized.racks[0];
		expect(rack.size).toBe(60);
		expect(rack.name).toBe("Rack 1");
		expect(normalized.powerCap).toBe(2000);
		expect(normalized.devices.ok.pwr.type).toBe("cord");
		expect(normalized.devices.ok.pwr.w).toBe(15);
		expect(rack.slots).toHaveLength(rack.size);
		expect(rack.slots[0].items).toEqual([{ id: "ok", u: 6 }]);
		expect(rack.slots[1]).toEqual(mkSlot());
		expect(normalized.selId).toBeNull();
	});

	it("drops impossible duplicate and over-capacity slot topology", () => {
		const normalized = normalizeState({
			rackSize: 12,
			devices: {
				first: { ...oneU, id: "first" },
				second: { ...oneU, id: "second" },
				multi: { ...twoU, id: "multi" },
			},
			slots: [
				{
					items: [
						{ id: "first", u: 6 },
						{ id: "second", u: 6 },
					],
					spanOf: null,
				},
				{ items: [{ id: "first", u: 6 }], spanOf: null },
				{ items: [{ id: "multi", u: 6 }], spanOf: null },
				{ items: [], spanOf: { id: "other", offset: 1 } },
			],
		});

		const { slots } = normalized.racks[0];
		expect(slots[0].items).toEqual([{ id: "first", u: 6 }]);
		expect(slots[1]).toEqual(mkSlot());
		expect(slots[2]).toEqual(mkSlot());
		expect(slots[3]).toEqual(mkSlot());
		expect(Object.keys(normalized.devices)).toEqual(["first"]);
	});

	it("normalizes shelf contents to valid unique single-U items within capacity", () => {
		const normalized = normalizeState({
			rackSize: 12,
			devices: {
				shelf: {
					...shelfLib,
					id: "shelf",
					shelved: [
						{ ...oneU, id: "first", u: 3 },
						{ ...oneU, id: "first", u: 3, name: "Duplicate" },
						{ ...twoU, id: "multi" },
						{ ...shelfLib, id: "nested" },
						{ ...oneU, id: "second", u: 4 },
					],
				},
			},
			slots: [{ items: [{ id: "shelf", u: 6 }], spanOf: null }],
		});

		expect(Object.keys(normalized.devices)).toEqual(["shelf"]);
		expect(normalized.devices.shelf.shelved.map((it) => it.id)).toEqual([
			"first",
		]);
	});

	it("enforces globally unique IDs across placed devices and all shelf contents", () => {
		const normalized = normalizeState({
			rackSize: 12,
			devices: {
				placed: { ...oneU, id: "placed" },
				shelfA: {
					...shelfLib,
					id: "shelfA",
					shelved: [
						{ ...oneU, id: "placed", name: "Duplicate of placed", u: 3 },
						{ ...oneU, id: "shared", u: 3 },
					],
				},
				shelfB: {
					...shelfLib,
					id: "shelfB",
					shelved: [{ ...oneU, id: "shared", u: 3 }],
				},
			},
			slots: [
				{ items: [{ id: "placed", u: 6 }], spanOf: null },
				{ items: [{ id: "shelfA", u: 6 }], spanOf: null },
				{ items: [{ id: "shelfB", u: 6 }], spanOf: null },
			],
		});

		expect(normalized.devices.shelfA.shelved.map((it) => it.id)).toEqual([
			"shared",
		]);
		expect(normalized.devices.shelfB.shelved).toEqual([]);
	});
});

describe("reducer placement invariants", () => {
	it("ignores invalid placement instead of throwing or corrupting slots", () => {
		const device = deviceFromLib(twoU);

		expect(() =>
			reducer(INIT, { type: "PLACE_DEVICE", rackId: RID, device, rowIndex: R(INIT).size }),
		).not.toThrow();
		expect(
			reducer(INIT, { type: "PLACE_DEVICE", rackId: RID, device, rowIndex: R(INIT).size }),
		).toEqual(INIT);
	});

	it("moves devices between rows atomically and rejects invalid moves", () => {
		const withDevice = place(INIT, twoU, 0);
		const deviceId = Object.keys(withDevice.devices)[0];

		const moved = reducer(withDevice, {
			type: "MOVE_DEVICES", rackId: RID,
			moves: [{ id: deviceId, row: 3 }],
		});
		expect(findRow(V(moved).slots, deviceId)).toBe(3);
		expect(V(moved).slots[0]).toEqual(mkSlot());
		expect(V(moved).slots[4].spanOf).toEqual({ id: deviceId, offset: 1 });

		const rejected = reducer(moved, {
			type: "MOVE_DEVICES", rackId: RID,
			moves: [{ id: deviceId, row: R(INIT).size }],
		});
		expect(rejected).toEqual(moved);
	});

	it("places new library devices on a shelf and rejects ones that don't fit", () => {
		const withShelf = place(INIT, shelfLib, 0);
		const shelfId = Object.keys(withShelf.devices)[0];

		expect(
			reducer(withShelf, {
				type: "PLACE_ON_SHELF",
				shelfId,
				device: deviceFromLib(twoU),
			}),
		).toEqual(withShelf);

		const device = deviceFromLib(oneU);
		const shelved = reducer(withShelf, { type: "PLACE_ON_SHELF", shelfId, device });
		expect(shelved.devices[device.id]).toBeUndefined();
		expect(shelved.devices[shelfId].shelved).toEqual([device]);
	});

	it("moves rack devices to shelves and shelf items back to the rack atomically", () => {
		const withShelf = place(INIT, shelfLib, 0);
		const shelfId = Object.keys(withShelf.devices)[0];
		const withDevice = place(withShelf, oneU, 1);
		const deviceId = Object.keys(withDevice.devices).find(
			(id) => id !== shelfId,
		);

		const shelved = reducer(withDevice, {
			type: "MOVE_DEVICE_TO_SHELF",
			shelfId,
			deviceId,
		});
		expect(shelved.devices[deviceId]).toBeUndefined();
		expect(shelved.devices[shelfId].shelved).toHaveLength(1);
		expect(V(shelved).slots[1]).toEqual(mkSlot());

		const unshelved = reducer(shelved, {
			type: "MOVE_SHELF_ITEM_TO_RACK", rackId: RID,
			shelfId,
			deviceId,
			rowIndex: 2,
		});
		expect(unshelved.devices[deviceId].name).toBe(oneU.name);
		expect(unshelved.devices[shelfId].shelved).toEqual([]);
		expect(findRow(V(unshelved).slots, deviceId)).toBe(2);
	});

	it("moves shelf items between shelves atomically and rejects full targets", () => {
		const source = deviceFromLib(shelfLib);
		const target = deviceFromLib(shelfLib);
		target.shelved = [{ ...deviceFromLib(oneU), id: "full", u: 6 }];
		const item = { ...deviceFromLib(oneU), id: "item", u: 3 };
		source.shelved = [item];
		const state = reducer(
			reducer(INIT, { type: "PLACE_DEVICE", rackId: RID, device: source, rowIndex: 0 }),
			{ type: "PLACE_DEVICE", rackId: RID, device: target, rowIndex: 1 },
		);

		expect(
			reducer(state, {
				type: "MOVE_SHELF_ITEM",
				deviceId: item.id,
				fromShelfId: source.id,
				toShelfId: target.id,
			}),
		).toEqual(state);

		const withRoom = reducer(state, {
			type: "REMOVE_FROM_SHELF",
			shelfId: target.id,
			deviceId: "full",
		});
		const moved = reducer(withRoom, {
			type: "MOVE_SHELF_ITEM",
			deviceId: item.id,
			fromShelfId: source.id,
			toShelfId: target.id,
		});
		expect(moved.devices[source.id].shelved).toEqual([]);
		expect(moved.devices[target.id].shelved.map((it) => it.id)).toEqual([
			item.id,
		]);
	});

	it("ignores updates for missing devices", () => {
		expect(
			reducer(INIT, {
				type: "UPDATE_DEVICE",
				deviceId: "missing",
				fields: { name: "Ghost" },
			}),
		).toEqual(INIT);
	});

	it("ignores device geometry fields in instance updates", () => {
		const withDevice = place(INIT, oneU, 0);
		const deviceId = Object.keys(withDevice.devices)[0];
		const updated = reducer(withDevice, {
			type: "UPDATE_DEVICE",
			deviceId,
			fields: { name: "Renamed", u: 3, uH: 4 },
		});

		expect(updated.devices[deviceId].name).toBe("Renamed");
		expect(updated.devices[deviceId].u).toBe(6);
		expect(updated.devices[deviceId].uH).toBe(1);
		expect(V(updated).slots[0].items).toEqual([{ id: deviceId, u: 6 }]);
	});

	it("removes devices that no longer fit after direct rack resize", () => {
		const withDevice = place(INIT, twoU, 10);
		const deviceId = Object.keys(withDevice.devices)[0];
		const selected = reducer(withDevice, {
			type: "SELECT_DEVICE",
			deviceId,
		});
		const resized = reducer(selected, { type: "SET_RACK_SIZE", rackId: RID, newSize: 8 });

		expect(R(resized).size).toBe(8);
		expect(resized.devices[deviceId]).toBeUndefined();
		expect(V(resized).slots).toHaveLength(8);
		expect(resized.selId).toBeNull();
	});
});

describe("library size edit invariant", () => {
	it("does not mutate placed device size or slot occupancy when editing a library template", () => {
		const withDevice = place(INIT, oneU, 0);
		const deviceId = Object.keys(withDevice.devices)[0];

		const updated = reducer(withDevice, {
			type: "UPDATE_LIB",
			libId: oneU.libId,
			isBuiltin: true,
			fields: {
				name: "Bigger template",
				cat: "compute",
				u: 6,
				uH: 4,
				pwr: { type: "cord", conn: "C13", w: 200 },
				ports: [],
			},
		});

		expect(updated.devices[deviceId].name).toBe("Bigger template");
		expect(updated.devices[deviceId].u).toBe(6);
		expect(updated.devices[deviceId].uH).toBe(1);
		expect(V(updated).slots[0].items).toEqual([{ id: deviceId, u: 6 }]);
		expect(V(updated).slots[1]).toEqual(mkSlot());
	});
});

describe("swap and group moves", () => {
	const full = { ...oneU, libId: "full", u: 6 };

	it("swaps two full-width devices when one is dropped on the other", async () => {
		const { planMoves, swapMoves } = await import("./helpers");
		let s = place(INIT, full, 0);
		s = place(s, full, 3);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[3].items[0].id];
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: swapMoves(V(s), a, b) });
		expect(findRow(V(s).slots, a)).toBe(3);
		expect(findRow(V(s).slots, b)).toBe(0);
		expect(planMoves(V(s), swapMoves(V(s), a, b))).not.toBeNull();
	});

	it("moves a group as one unit and refuses partial moves", async () => {
		const { groupMoves } = await import("./helpers");
		let s = place(INIT, oneU, 0);
		s = place(s, twoU, 1);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[1].items[0].id];
		s = reducer(s, { type: "GROUP_DEVICES", ids: [a, b] });
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: groupMoves(V(s), a, 5) });
		expect(findRow(V(s).slots, a)).toBe(5);
		expect(findRow(V(s).slots, b)).toBe(6);
		expect(V(s).slots[7].spanOf?.id).toBe(b);

		// Bottom edge: b would overflow a 12U rack → nothing moves
		const before = V(s).slots;
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: groupMoves(V(s), a, 10) });
		expect(V(s).slots).toBe(before);
	});

	it("selecting a grouped device selects the group; ungroup clears it", () => {
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[1].items[0].id];
		s = reducer(s, { type: "GROUP_DEVICES", ids: [a, b] });
		s = reducer(s, { type: "SELECT_DEVICE", deviceId: a });
		expect(s.selIds.sort()).toEqual([a, b].sort());
		s = reducer(s, { type: "UNGROUP", groupId: s.devices[a].groupId });
		expect(s.devices[a].groupId).toBeUndefined();
		expect(normalizeState(s).devices[b].groupId).toBeUndefined();
	});
});

describe("selection and group cleanup", () => {
	function twoSelected() {
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[1].items[0].id];
		s = reducer(s, { type: "SELECT_DEVICE", deviceId: a });
		s = reducer(s, { type: "SELECT_DEVICE", deviceId: b, additive: true });
		return { s, a, b };
	}

	it("drops deleted ids from selIds and falls back selId to a live one", () => {
		const { s, a, b } = twoSelected();
		const next = reducer(s, { type: "DELETE_DEVICE", deviceId: b });
		expect(next.selIds).toEqual([a]);
		expect(next.selId).toBe(a);
	});

	it("clears selIds on CLEAR_RACK", () => {
		const { s } = twoSelected();
		expect(reducer(s, { type: "CLEAR_RACK" }).selIds).toEqual([]);
	});

	it("drops shelved ids from selIds", () => {
		let { s, a, b } = twoSelected();
		s = place(s, shelfLib, 5);
		const shelfId = V(s).slots[5].items[0].id;
		s = reducer(s, { type: "MOVE_DEVICE_TO_SHELF", deviceId: b, shelfId });
		expect(s.selIds).toEqual([a]);
	});

	it("removes the group tag when only one member is left", () => {
		const { s: base, a, b } = twoSelected();
		let s = reducer(base, { type: "GROUP_DEVICES", ids: [a, b] });
		s = reducer(s, { type: "DELETE_DEVICE", deviceId: b });
		expect(s.devices[a].groupId).toBeUndefined();
	});

	it("leaves state untouched when there is nothing to tidy", () => {
		const s = place(INIT, oneU, 0);
		expect(reducer(s, { type: "SET_RACK_NAME", rackId: RID, name: R(s).name }).devices).toBe(
			s.devices,
		);
	});

	it("swaps an adjacent 1U and 2U device", async () => {
		const { swapMoves } = await import("./helpers");
		let s = place(INIT, oneU, 0);
		s = place(s, twoU, 1);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[1].items[0].id];
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: swapMoves(V(s), a, b) });
		expect(findRow(V(s).slots, b)).toBe(0);
		expect(findRow(V(s).slots, a)).toBe(2);
	});

	it("strips groupId from shelved items on load", () => {
		const s = normalizeState({
			rackSize: 12,
			devices: {
				sh: { ...shelfLib, shelved: [{ ...oneU, id: "x", groupId: "g1" }] },
			},
			slots: [{ items: [{ id: "sh", u: 6 }] }],
		});
		expect(s.devices.sh.shelved[0].groupId).toBeUndefined();
	});
});

describe("undo history", () => {
	const run = (h, ...actions) => actions.reduce(historyReducer, h);
	const placeAct = (row) => ({
		type: "PLACE_DEVICE", rackId: RID,
		device: deviceFromLib(oneU),
		rowIndex: row,
	});

	it("undoes and redoes layout changes", () => {
		let h = run(initHistory(INIT), placeAct(0), placeAct(1));
		const id = V(h.present).slots[1].items[0].id;
		h = run(h, { type: "DELETE_DEVICE", deviceId: id });
		expect(h.present.devices[id]).toBeUndefined();
		h = run(h, { type: "UNDO" });
		expect(findRow(V(h.present).slots, id)).toBe(1);
		h = run(h, { type: "REDO" });
		expect(h.present.devices[id]).toBeUndefined();
		h = run(h, { type: "UNDO" }, { type: "UNDO" }, { type: "UNDO" });
		expect(h.present).toBe(INIT);
		expect(run(h, { type: "UNDO" })).toBe(h); // nothing left
	});

	it("skips selection and no-ops; a new change drops redo", () => {
		let h = run(initHistory(INIT), placeAct(0));
		const id = V(h.present).slots[0].items[0].id;
		h = run(
			h,
			{ type: "SELECT_DEVICE", deviceId: id },
			placeAct(0), // occupied row: no-op
		);
		expect(h.past).toHaveLength(1);
		h = run(h, { type: "UNDO" }, placeAct(3));
		expect(h.future).toHaveLength(0);
	});

	it("merges typing runs and BATCH into one step; caps at 50", () => {
		let h = run(
			initHistory(INIT),
			{ type: "SET_RACK_NAME", rackId: RID, name: "a" },
			{ type: "SET_RACK_NAME", rackId: RID, name: "ab" },
		);
		expect(h.past).toHaveLength(1);
		h = run(h, placeAct(0), placeAct(1));
		const ids = [0, 1].map((r) => V(h.present).slots[r].items[0].id);
		h = run(h, {
			type: "BATCH",
			actions: ids.map((deviceId) => ({ type: "DELETE_DEVICE", deviceId })),
		});
		expect(Object.keys(h.present.devices)).toHaveLength(0);
		h = run(h, { type: "UNDO" });
		expect(Object.keys(h.present.devices)).toHaveLength(2);

		// Alternating types so runs don't merge: 120 steps, capped at 50
		for (let i = 0; i < 60; i++)
			h = run(
				h,
				{ type: "SET_POWER_CAP", cap: i },
				{ type: "SET_RACK_NAME", rackId: RID, name: `r${i}` },
			);
		expect(h.past).toHaveLength(50);
	});

	it("delete drops the id from the multi-selection", () => {
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		const [a, b] = [V(s).slots[0].items[0].id, V(s).slots[1].items[0].id];
		s = reducer(s, { type: "SELECT_DEVICE", deviceId: a, additive: true });
		s = reducer(s, { type: "SELECT_DEVICE", deviceId: b, additive: true });
		s = reducer(s, { type: "DELETE_DEVICE", deviceId: a });
		expect(s.selIds).toEqual([b]);
		expect(selectedIds(s)).toEqual([b]);
		expect(reducer(s, { type: "CLEAR_RACK" }).selIds).toEqual([]);
	});

	it("groupHue is stable and in range", () => {
		expect(groupHue("abc")).toBe(groupHue("abc"));
		expect(groupHue("abc")).not.toBe(groupHue("abd"));
		for (const id of ["x", "lzq93k", "0".repeat(40)]) {
			expect(groupHue(id)).toBeGreaterThanOrEqual(0);
			expect(groupHue(id)).toBeLessThan(360);
		}
	});
});

describe("insert on a full row", () => {
	it("moving a device up onto a full row reorders and reuses its old slot", async () => {
		const { insertMoves } = await import("./helpers");
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		s = place(s, oneU, 2);
		s = place(s, oneU, 6);
		const [a, b, c, far] = [0, 1, 2, 6].map((r) => V(s).slots[r].items[0].id);
		s = reducer(s, {
			type: "MOVE_DEVICES", rackId: RID,
			moves: insertMoves(V(s), [{ id: c, row: 0 }]),
		});
		expect([c, a, b, far].map((id) => findRow(V(s).slots, id))).toEqual([
			0, 1, 2, 6,
		]);
	});

	it("inserting a 2U library device pushes rows down by two, up to the gap", () => {
		let s = place(INIT, oneU, 3);
		s = place(s, oneU, 4);
		s = place(s, oneU, 8);
		const [a, b, far] = [3, 4, 8].map((r) => V(s).slots[r].items[0].id);
		const dev = deviceFromLib(twoU);
		s = reducer(s, { type: "INSERT_DEVICE", rackId: RID, device: dev, rowIndex: 3 });
		expect([dev.id, a, b, far].map((id) => findRow(V(s).slots, id))).toEqual([
			3, 5, 6, 8,
		]);
	});

	it("refuses an insert that would push devices off the bottom", () => {
		let s = INIT;
		for (let r = 0; r < 12; r++) s = place(s, oneU, r);
		const before = V(s).slots;
		s = reducer(s, {
			type: "INSERT_DEVICE", rackId: RID,
			device: deviceFromLib(oneU),
			rowIndex: 4,
		});
		expect(V(s).slots).toBe(before);
	});
});

describe("loadSaved (refresh keeps the rack)", () => {
	function fakeStorage(init = {}) {
		const m = { ...init };
		return {
			m,
			getItem: (k) => m[k] ?? null,
			setItem: (k, v) => {
				m[k] = String(v);
			},
		};
	}

	it("restores the saved rack and keeps an unreadable save aside", async () => {
		const { loadSaved } = await import("./AppContext");
		const saved = place(INIT, oneU, 2);
		globalThis.localStorage = fakeStorage({ rackitect_v1: JSON.stringify(saved) });
		const restored = loadSaved();
		expect(Object.keys(restored.devices)).toEqual(Object.keys(saved.devices));

		globalThis.localStorage = fakeStorage({ rackitect_v2: "{broken" });
		expect(loadSaved()).toBe(INIT);
		const copies = Object.keys(localStorage.m).filter((k) =>
			k.startsWith("rackitect_v2_corrupt_"),
		);
		expect(copies).toHaveLength(1);

		// new key wins; old key (left for old builds) is only a fallback
		const newer = place(INIT, oneU, 5);
		globalThis.localStorage = fakeStorage({
			rackitect_v1: JSON.stringify(saved),
			rackitect_v2: JSON.stringify(newer),
		});
		expect(Object.keys(loadSaved().devices)).toEqual(Object.keys(newer.devices));
		delete globalThis.localStorage;
	});
});

describe("dropPlan", () => {
	async function rack(...rows) {
		let s = INIT;
		for (const [lib, r] of rows) s = place(s, lib, r);
		return s;
	}
	const at = (s, id) => findRow(V(s).slots, id);
	const idAt = (s, r) => V(s).slots[r].items[0].id;

	it("2U below a 1U moves above it (1U pushed into the freed space)", async () => {
		const { dropPlan } = await import("./helpers");
		let s = await rack([oneU, 0], [twoU, 1]);
		const [one, two] = [idAt(s, 0), idAt(s, 1)];
		const plan = dropPlan(V(s), s.devices[two], 0);
		expect(plan.kind).toBe("insert");
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: plan.moves });
		expect([at(s, two), at(s, one)]).toEqual([0, 2]);
	});

	it("1U dropped on either half of the 2U below it ends up under it", async () => {
		const { dropPlan } = await import("./helpers");
		for (const target of [1, 2]) {
			let s = await rack([oneU, 0], [twoU, 1]);
			const [one, two] = [idAt(s, 0), idAt(s, 1)];
			const plan = dropPlan(V(s), s.devices[one], target);
			expect(plan.kind).toBe("reorder");
			s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: plan.moves });
			expect([at(s, two), at(s, one)]).toEqual([0, 2]);
		}
	});

	it("plain move into empty space, library insert, and refusal", async () => {
		const { dropPlan } = await import("./helpers");
		const s = await rack([oneU, 0]);
		expect(dropPlan(V(s), s.devices[idAt(s, 0)], 5).kind).toBe("move");
		expect(dropPlan(V(s), deviceFromLib(oneU), 0).kind).toBe("insert");
		let full = INIT;
		for (let r = 0; r < 12; r++) full = place(full, oneU, r);
		expect(dropPlan(V(full), deviceFromLib(oneU), 3)).toBeNull();
	});
});

describe("audit fixes", () => {
	it("rackSummary counts a row shared by two half-width devices once", async () => {
		const { rackSummary } = await import("./helpers");
		const half = { ...oneU, u: 3 };
		let s = place(INIT, half, 0);
		s = place(s, half, 0);
		s = place(s, twoU, 4);
		expect(rackSummary(V(s))).toMatchObject({ uU: 3, freeU: 9, w: 300 });
	});

	it("a shelf holding items keeps its category (device edit and library edit)", () => {
		let s = place(INIT, shelfLib, 0);
		const shelfId = V(s).slots[0].items[0].id;
		s = reducer(s, { type: "PLACE_ON_SHELF", shelfId, device: deviceFromLib(oneU) });
		const edited = reducer(s, {
			type: "UPDATE_DEVICE",
			deviceId: shelfId,
			fields: { cat: "compute", name: "Tray" },
		});
		expect(edited.devices[shelfId]).toMatchObject({ cat: "shelf", name: "Tray" });
		const lib = reducer(s, {
			type: "UPDATE_LIB",
			libId: "shelf",
			isBuiltin: true,
			fields: { name: "Tray", cat: "misc", pwr: shelfLib.pwr, ports: [] },
		});
		expect(lib.devices[shelfId]).toMatchObject({ cat: "shelf", name: "Tray" });
		expect(normalizeState(edited).devices[shelfId].shelved).toHaveLength(1);
	});

	it("library edits reach devices sitting on shelves", () => {
		let s = place(INIT, shelfLib, 0);
		const shelfId = V(s).slots[0].items[0].id;
		s = reducer(s, { type: "PLACE_ON_SHELF", shelfId, device: deviceFromLib(oneU) });
		s = reducer(s, {
			type: "UPDATE_LIB",
			libId: "server",
			isBuiltin: true,
			fields: { ...oneU, name: "Pi", pwr: { type: "usb", conn: "", w: 7 } },
		});
		expect(s.devices[shelfId].shelved[0]).toMatchObject({ name: "Pi", pwr: { w: 7 } });
	});

	it("imported library entries are validated", async () => {
		const { getEffectiveLib } = await import("./helpers");
		const s = normalizeState({
			customLib: [{ libId: "x" }, null, "junk", { name: "no id" }],
			libOverrides: { server: { name: "S", uH: "2", ports: "bad" }, bad: 5 },
		});
		expect(s.customLib).toHaveLength(1);
		expect(s.customLib[0]).toMatchObject({ libId: "x", name: "Untitled device", uH: 1, ports: [] });
		expect(Object.keys(s.libOverrides)).toEqual(["server"]);
		expect(s.libOverrides.server).toMatchObject({ uH: 2, ports: [] });
		const x = getEffectiveLib(s).find((l) => l.libId === "x");
		expect(() => deviceFromLib(x)).not.toThrow();
		expect(normalizeState({ customLib: [{ libId: "c", _isCustom: true }] }).customLib[0]._isCustom).toBe(true);
	});

	it("the app context exposes saveError to the toolbar", async () => {
		const { createElement } = await import("react");
		const { renderToString } = await import("react-dom/server");
		const { AppProvider, useApp } = await import("./AppContext");
		let ctx;
		function Probe() {
			ctx = useApp();
			return null;
		}
		renderToString(createElement(AppProvider, null, createElement(Probe)));
		expect(ctx).toHaveProperty("saveError", false);
	});
});

describe("dropPlan edges", () => {
	const idAt = (s, r) => V(s).slots[r].items[0].id;
	const rackOf = (size, rows) => {
		let s = reducer(INIT, { type: "SET_RACK_SIZE", rackId: RID, newSize: size });
		for (const [lib, r] of rows) s = place(s, lib, r);
		return s;
	};

	it("clamps a group drag at the top and bottom instead of throwing", async () => {
		const { clampDropRow, dropPlan } = await import("./helpers");
		let s = rackOf(12, [[oneU, 0], [oneU, 2]]);
		const [a, b] = [idAt(s, 0), idAt(s, 2)];
		s = reducer(s, { type: "GROUP_DEVICES", ids: [a, b] });
		expect(clampDropRow(V(s), s.devices[b], 0)).toBe(2); // a would land at -2
		expect(clampDropRow(V(s), s.devices[a], 11)).toBe(9); // b would land at 13
		expect(() => dropPlan(V(s), s.devices[b], 0)).not.toThrow();
		const plan = dropPlan(V(s), s.devices[a], clampDropRow(V(s), s.devices[a], 11));
		expect(plan.kind).toBe("move");
		const { insertMoves } = await import("./helpers");
		expect(insertMoves(V(s), [{ id: a, row: -2 }])).toBeNull();
	});

	it("moving up onto the lower half of a taller device inserts above it", async () => {
		const { dropPlan } = await import("./helpers");
		let s = rackOf(12, [[twoU, 0], [oneU, 2]]);
		const [two, one] = [idAt(s, 0), idAt(s, 2)];
		const plan = dropPlan(V(s), s.devices[one], 1);
		expect(plan).toMatchObject({ kind: "insert", row: 0 });
		s = reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: plan.moves });
		expect([findRow(V(s).slots, one), findRow(V(s).slots, two)]).toEqual([0, 1]);
	});

	it("a library drop uses free rows above when the rows below are full", async () => {
		const { dropPlan } = await import("./helpers");
		let s = rackOf(8, [[oneU, 4], [oneU, 5], [oneU, 6], [oneU, 7]]);
		const ids = [4, 5, 6, 7].map((r) => idAt(s, r));
		const dev = deviceFromLib(oneU);
		const plan = dropPlan(V(s), dev, 7);
		expect(plan).toMatchObject({ kind: "insertUp", row: 7 });
		s = reducer(s, { type: "INSERT_DEVICE", rackId: RID, device: dev, rowIndex: plan.row });
		expect([...ids, dev.id].map((id) => findRow(V(s).slots, id))).toEqual([
			3, 4, 5, 6, 7,
		]);
	});
});

describe("nudge and selection drag", () => {
	const idAt = (s, r) => V(s).slots[r].items[0].id;
	const rackOf = (rows) => {
		let s = INIT;
		for (const [lib, r] of rows) s = place(s, lib, r);
		return s;
	};
	const apply = (s, plan) => reducer(s, { type: "MOVE_DEVICES", rackId: RID, moves: plan.moves });

	it("arrow nudges swap with the neighbour, hop a taller one, and stop at the edge", async () => {
		const { nudgePlan } = await import("./helpers");
		let s = rackOf([[oneU, 0], [oneU, 1], [twoU, 2]]);
		const [a, b, two] = [idAt(s, 0), idAt(s, 1), idAt(s, 2)];
		expect(nudgePlan(V(s), [a], -1)).toBeNull();
		s = apply(s, nudgePlan(V(s), [a], 1));
		expect([findRow(V(s).slots, b), findRow(V(s).slots, a)]).toEqual([0, 1]);
		s = apply(s, nudgePlan(V(s), [a], 1));
		expect([findRow(V(s).slots, two), findRow(V(s).slots, a)]).toEqual([1, 3]);
		s = apply(s, nudgePlan(V(s), [a], -1));
		expect([findRow(V(s).slots, a), findRow(V(s).slots, two)]).toEqual([1, 2]);
	});

	it("a multi-selection moves as one unit and leaves others alone", async () => {
		const { asSelGroup, dropPlan, nudgePlan } = await import("./helpers");
		let s = rackOf([[oneU, 0], [oneU, 2], [oneU, 5]]);
		const [a, b, c] = [idAt(s, 0), idAt(s, 2), idAt(s, 5)];
		const g = asSelGroup(V(s), [a, b]);
		s = apply(s, dropPlan(g, g.devices[a], 3));
		expect([a, b, c].map((id) => findRow(V(s).slots, id))).toEqual([3, 5, 2]); // c slides up into the freed rows
		s = apply(s, nudgePlan(V(s), [a, b], -1));
		expect([a, b].map((id) => findRow(V(s).slots, id))).toEqual([2, 4]);
		expect(s.devices[a].groupId).toBeUndefined(); // the temporary group never reaches state
	});
});

describe("several racks", () => {
	const run = (h, ...actions) => actions.reduce(historyReducer, h);
	const twoRacks = () => reducer(INIT, { type: "ADD_RACK" });

	it("ADD_RACK appends a 12U rack named by position", () => {
		const s = twoRacks();
		expect(s.racks).toHaveLength(2);
		expect(R(s, 1)).toMatchObject({ name: "Rack 2", size: 12 });
		expect(R(s, 1).slots).toHaveLength(12);
	});

	it("unknown rackId leaves the state unchanged", () => {
		expect(place(INIT, oneU, 0, "nope")).toBe(INIT);
	});

	it("MOVE_DEVICES across racks", () => {
		let h = run(initHistory(twoRacks()));
		const [A, B] = h.present.racks.map((r) => r.id);
		h = run(h, {
			type: "PLACE_DEVICE",
			rackId: A,
			device: deviceFromLib(oneU),
			rowIndex: 0,
		});
		const id = V(h.present).slots[0].items[0].id;
		const before = h.present;
		h = run(h, { type: "MOVE_DEVICES", rackId: B, moves: [{ id, row: 2 }] });
		expect(findRow(R(h.present).slots, id)).toBe(-1);
		expect(findRow(R(h.present, 1).slots, id)).toBe(2);
		h = run(h, { type: "UNDO" });
		expect(h.present).toBe(before);
		expect(findRow(R(h.present).slots, id)).toBe(0);
		expect(findRow(R(h.present, 1).slots, id)).toBe(-1);
	});

	it("SET_RACK_SIZE clamps", () => {
		const s = reducer(INIT, { type: "SET_RACK_SIZE", rackId: RID, newSize: 999 });
		expect(R(s).size).toBe(60);
		expect(R(s).slots).toHaveLength(60);
		expect(reducer(INIT, { type: "SET_RACK_SIZE", rackId: RID, newSize: "abc" })).toBe(INIT);
	});

	it("SET_RACK_SIZE on one rack keeps devices in the others", () => {
		let s = twoRacks();
		s = place(s, oneU, 0);
		s = place(s, oneU, 10, R(s, 1).id);
		const keep = R(s).slots[0].items[0].id;
		const drop = R(s, 1).slots[10].items[0].id;
		s = reducer(s, { type: "SET_RACK_SIZE", rackId: R(s, 1).id, newSize: 4 });
		expect(s.devices[keep]).toBeDefined();
		expect(s.devices[drop]).toBeUndefined();
	});

	it("REMOVE_RACK", () => {
		let h = run(initHistory(twoRacks()));
		const B = R(h.present, 1).id;
		h = run(h, {
			type: "PLACE_DEVICE",
			rackId: B,
			device: deviceFromLib(shelfLib),
			rowIndex: 0,
		});
		const shelfId = R(h.present, 1).slots[0].items[0].id;
		h = run(
			h,
			{ type: "PLACE_ON_SHELF", shelfId, device: deviceFromLib(oneU) },
			{ type: "SELECT_DEVICE", deviceId: shelfId },
		);
		const before = h.present;
		h = run(h, { type: "REMOVE_RACK", rackId: B });
		expect(h.present.racks).toHaveLength(1);
		expect(h.present.devices[shelfId]).toBeUndefined();
		expect(h.present.selId).toBeNull();
		expect(h.present.selIds).toEqual([]);
		h = run(h, { type: "UNDO" });
		expect(h.present).toBe(before);
		expect(h.present.devices[shelfId].shelved).toHaveLength(1);
		expect(reducer(INIT, { type: "REMOVE_RACK", rackId: RID })).toBe(INIT);
	});

	it("GROUP_DEVICES refuses ids in two racks", () => {
		let s = twoRacks();
		s = place(s, oneU, 0);
		s = place(s, oneU, 0, R(s, 1).id);
		const ids = [R(s).slots[0].items[0].id, R(s, 1).slots[0].items[0].id];
		expect(reducer(s, { type: "GROUP_DEVICES", ids })).toBe(s);
	});

	it("CLEAR_RACK keeps racks", () => {
		let s = twoRacks();
		const B = R(s, 1).id;
		s = reducer(s, { type: "SET_RACK_SIZE", rackId: B, newSize: 20 });
		s = reducer(s, { type: "SET_RACK_NAME", rackId: B, name: "Lab" });
		s = place(s, oneU, 0);
		s = place(s, oneU, 15, B);
		s = reducer(s, { type: "CLEAR_RACK" });
		expect(s.devices).toEqual({});
		expect(s.racks.map((r) => [r.name, r.size, r.slots.length])).toEqual([
			["Rack 1", 12, 12],
			["Lab", 20, 20],
		]);
		expect(s.racks.every((r) => r.slots.every((sl) => !sl.items.length))).toBe(true);
	});

	it("SET_LAYOUT", () => {
		const s = reducer(INIT, { type: "SET_LAYOUT", layout: "stack" });
		expect(s.layout).toBe("stack");
		expect(reducer(s, { type: "SET_LAYOUT", layout: "diagonal" })).toBe(s);
	});

	it("SET_RACK_NAME typing merges per rack", () => {
		let h = run(initHistory(twoRacks()));
		const [A, B] = h.present.racks.map((r) => r.id);
		h = run(
			h,
			{ type: "SET_RACK_NAME", rackId: A, name: "a" },
			{ type: "SET_RACK_NAME", rackId: A, name: "ab" },
			{ type: "SET_RACK_NAME", rackId: B, name: "b" },
		);
		expect(h.past).toHaveLength(2);
		expect(h.present.racks.map((r) => r.name)).toEqual(["ab", "b"]);
	});
});

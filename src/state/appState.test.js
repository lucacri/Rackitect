import { describe, expect, it } from "vitest";
import { RACK_SIZES } from "../data/constants";
import {
	deviceFromLib,
	findRow,
	groupHue,
	mkSlot,
	normalizeState,
	selectedIds,
} from "./helpers";
import { INIT, historyReducer, initHistory, reducer } from "./AppContext";

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

function place(state, lib, rowIndex) {
	return reducer(state, {
		type: "PLACE_DEVICE",
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

		expect(RACK_SIZES).toContain(normalized.rackSize);
		expect(normalized.rackName).toBe("Rack 1");
		expect(normalized.powerCap).toBe(2000);
		expect(normalized.devices.ok.pwr.type).toBe("cord");
		expect(normalized.devices.ok.pwr.w).toBe(15);
		expect(normalized.slots).toHaveLength(normalized.rackSize);
		expect(normalized.slots[0].items).toEqual([{ id: "ok", u: 6 }]);
		expect(normalized.slots[1]).toEqual(mkSlot());
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

		expect(normalized.slots[0].items).toEqual([{ id: "first", u: 6 }]);
		expect(normalized.slots[1]).toEqual(mkSlot());
		expect(normalized.slots[2]).toEqual(mkSlot());
		expect(normalized.slots[3]).toEqual(mkSlot());
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
			reducer(INIT, { type: "PLACE_DEVICE", device, rowIndex: INIT.rackSize }),
		).not.toThrow();
		expect(
			reducer(INIT, { type: "PLACE_DEVICE", device, rowIndex: INIT.rackSize }),
		).toEqual(INIT);
	});

	it("moves devices between rows atomically and rejects invalid moves", () => {
		const withDevice = place(INIT, twoU, 0);
		const deviceId = Object.keys(withDevice.devices)[0];

		const moved = reducer(withDevice, {
			type: "MOVE_DEVICE_TO_RACK",
			deviceId,
			rowIndex: 3,
		});
		expect(findRow(moved.slots, deviceId)).toBe(3);
		expect(moved.slots[0]).toEqual(mkSlot());
		expect(moved.slots[4].spanOf).toEqual({ id: deviceId, offset: 1 });

		const rejected = reducer(moved, {
			type: "MOVE_DEVICE_TO_RACK",
			deviceId,
			rowIndex: INIT.rackSize,
		});
		expect(rejected).toEqual(moved);
	});

	it("rejects invalid direct shelf placement and cleans slots for valid direct shelf placement", () => {
		const withShelf = place(INIT, shelfLib, 0);
		const shelfId = Object.keys(withShelf.devices)[0];
		const withDevice = place(withShelf, oneU, 1);
		const deviceId = Object.keys(withDevice.devices).find(
			(id) => id !== shelfId,
		);

		expect(
			reducer(withShelf, {
				type: "PLACE_ON_SHELF",
				shelfId,
				device: deviceFromLib(twoU),
			}),
		).toEqual(withShelf);

		const shelved = reducer(withDevice, {
			type: "PLACE_ON_SHELF",
			shelfId,
			device: withDevice.devices[deviceId],
		});
		expect(shelved.devices[deviceId]).toBeUndefined();
		expect(shelved.devices[shelfId].shelved).toHaveLength(1);
		expect(shelved.slots[1]).toEqual(mkSlot());
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
		expect(shelved.slots[1]).toEqual(mkSlot());

		const unshelved = reducer(shelved, {
			type: "MOVE_SHELF_ITEM_TO_RACK",
			shelfId,
			deviceId,
			rowIndex: 2,
		});
		expect(unshelved.devices[deviceId].name).toBe(oneU.name);
		expect(unshelved.devices[shelfId].shelved).toEqual([]);
		expect(findRow(unshelved.slots, deviceId)).toBe(2);
	});

	it("moves shelf items between shelves atomically and rejects full targets", () => {
		const source = deviceFromLib(shelfLib);
		const target = deviceFromLib(shelfLib);
		target.shelved = [{ ...deviceFromLib(oneU), id: "full", u: 6 }];
		const item = { ...deviceFromLib(oneU), id: "item", u: 3 };
		source.shelved = [item];
		const state = reducer(
			reducer(INIT, { type: "PLACE_DEVICE", device: source, rowIndex: 0 }),
			{ type: "PLACE_DEVICE", device: target, rowIndex: 1 },
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
		expect(updated.slots[0].items).toEqual([{ id: deviceId, u: 6 }]);
	});

	it("removes devices that no longer fit after direct rack resize", () => {
		const withDevice = place(INIT, twoU, 10);
		const deviceId = Object.keys(withDevice.devices)[0];
		const selected = reducer(withDevice, {
			type: "SELECT_DEVICE",
			deviceId,
		});
		const resized = reducer(selected, { type: "SET_RACK_SIZE", newSize: 8 });

		expect(resized.rackSize).toBe(8);
		expect(resized.devices[deviceId]).toBeUndefined();
		expect(resized.slots).toHaveLength(8);
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
		expect(updated.slots[0].items).toEqual([{ id: deviceId, u: 6 }]);
		expect(updated.slots[1]).toEqual(mkSlot());
	});
});

describe("swap and group moves", () => {
	const full = { ...oneU, libId: "full", u: 6 };

	it("swaps two full-width devices when one is dropped on the other", async () => {
		const { planMoves, swapMoves } = await import("./helpers");
		let s = place(INIT, full, 0);
		s = place(s, full, 3);
		const [a, b] = [s.slots[0].items[0].id, s.slots[3].items[0].id];
		s = reducer(s, { type: "MOVE_DEVICES", moves: swapMoves(s, a, b) });
		expect(findRow(s.slots, a)).toBe(3);
		expect(findRow(s.slots, b)).toBe(0);
		expect(planMoves(s, swapMoves(s, a, b))).not.toBeNull();
	});

	it("moves a group as one unit and refuses partial moves", async () => {
		const { groupMoves } = await import("./helpers");
		let s = place(INIT, oneU, 0);
		s = place(s, twoU, 1);
		const [a, b] = [s.slots[0].items[0].id, s.slots[1].items[0].id];
		s = reducer(s, { type: "GROUP_DEVICES", ids: [a, b] });
		s = reducer(s, { type: "MOVE_DEVICES", moves: groupMoves(s, a, 5) });
		expect(findRow(s.slots, a)).toBe(5);
		expect(findRow(s.slots, b)).toBe(6);
		expect(s.slots[7].spanOf?.id).toBe(b);

		// Bottom edge: b would overflow a 12U rack → nothing moves
		const before = s.slots;
		s = reducer(s, { type: "MOVE_DEVICES", moves: groupMoves(s, a, 10) });
		expect(s.slots).toBe(before);
	});

	it("selecting a grouped device selects the group; ungroup clears it", () => {
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		const [a, b] = [s.slots[0].items[0].id, s.slots[1].items[0].id];
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
		const [a, b] = [s.slots[0].items[0].id, s.slots[1].items[0].id];
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
		const shelfId = s.slots[5].items[0].id;
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
		expect(reducer(s, { type: "SET_RACK_NAME", name: s.rackName }).devices).toBe(
			s.devices,
		);
	});

	it("swaps an adjacent 1U and 2U device", async () => {
		const { swapMoves } = await import("./helpers");
		let s = place(INIT, oneU, 0);
		s = place(s, twoU, 1);
		const [a, b] = [s.slots[0].items[0].id, s.slots[1].items[0].id];
		s = reducer(s, { type: "MOVE_DEVICES", moves: swapMoves(s, a, b) });
		expect(findRow(s.slots, b)).toBe(0);
		expect(findRow(s.slots, a)).toBe(2);
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
		type: "PLACE_DEVICE",
		device: deviceFromLib(oneU),
		rowIndex: row,
	});

	it("undoes and redoes layout changes", () => {
		let h = run(initHistory(INIT), placeAct(0), placeAct(1));
		const id = h.present.slots[1].items[0].id;
		h = run(h, { type: "DELETE_DEVICE", deviceId: id });
		expect(h.present.devices[id]).toBeUndefined();
		h = run(h, { type: "UNDO" });
		expect(findRow(h.present.slots, id)).toBe(1);
		h = run(h, { type: "REDO" });
		expect(h.present.devices[id]).toBeUndefined();
		h = run(h, { type: "UNDO" }, { type: "UNDO" }, { type: "UNDO" });
		expect(h.present).toBe(INIT);
		expect(run(h, { type: "UNDO" })).toBe(h); // nothing left
	});

	it("skips selection, no-ops and skipHistory; a new change drops redo", () => {
		let h = run(initHistory(INIT), placeAct(0));
		const id = h.present.slots[0].items[0].id;
		h = run(
			h,
			{ type: "SELECT_DEVICE", deviceId: id },
			placeAct(0), // occupied row: no-op
			{ type: "LOAD", payload: h.present, skipHistory: true },
		);
		expect(h.past).toHaveLength(1);
		h = run(h, { type: "UNDO" }, placeAct(3));
		expect(h.future).toHaveLength(0);
	});

	it("merges typing runs and BATCH into one step; caps at 50", () => {
		let h = run(
			initHistory(INIT),
			{ type: "SET_RACK_NAME", name: "a" },
			{ type: "SET_RACK_NAME", name: "ab" },
		);
		expect(h.past).toHaveLength(1);
		h = run(h, placeAct(0), placeAct(1));
		const ids = [0, 1].map((r) => h.present.slots[r].items[0].id);
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
				{ type: "SET_RACK_NAME", name: `r${i}` },
			);
		expect(h.past).toHaveLength(50);
	});

	it("delete drops the id from the multi-selection", () => {
		let s = place(INIT, oneU, 0);
		s = place(s, oneU, 1);
		const [a, b] = [s.slots[0].items[0].id, s.slots[1].items[0].id];
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
		const [a, b, c, far] = [0, 1, 2, 6].map((r) => s.slots[r].items[0].id);
		s = reducer(s, {
			type: "MOVE_DEVICES",
			moves: insertMoves(s, [{ id: c, row: 0 }]),
		});
		expect([c, a, b, far].map((id) => findRow(s.slots, id))).toEqual([
			0, 1, 2, 6,
		]);
	});

	it("inserting a 2U library device pushes rows down by two, up to the gap", () => {
		let s = place(INIT, oneU, 3);
		s = place(s, oneU, 4);
		s = place(s, oneU, 8);
		const [a, b, far] = [3, 4, 8].map((r) => s.slots[r].items[0].id);
		const dev = deviceFromLib(twoU);
		s = reducer(s, { type: "INSERT_DEVICE", device: dev, rowIndex: 3 });
		expect([dev.id, a, b, far].map((id) => findRow(s.slots, id))).toEqual([
			3, 5, 6, 8,
		]);
	});

	it("refuses an insert that would push devices off the bottom", () => {
		let s = INIT;
		for (let r = 0; r < 12; r++) s = place(s, oneU, r);
		const before = s.slots;
		s = reducer(s, {
			type: "INSERT_DEVICE",
			device: deviceFromLib(oneU),
			rowIndex: 4,
		});
		expect(s.slots).toBe(before);
	});
});

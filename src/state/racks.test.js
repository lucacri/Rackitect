import { describe, expect, it } from "vitest";
import { findRow, normalizeState, placeDeviceInSlots } from "./helpers";
import {
	clampSize,
	crossRackPlan,
	firstFreeSpot,
	mkRack,
	rackOf,
	rackView,
	withRackSlots,
} from "./racks";

const oneU = {
	libId: "server",
	name: "Server",
	cat: "compute",
	uH: 1,
	u: 6,
	pwr: { type: "cord", conn: "C13", w: 100 },
	ports: [],
};
const shelfLib = { ...oneU, libId: "shelf", name: "Shelf", cat: "shelf" };
const at = (id, row, size = 12) => {
	const slots = Array.from({ length: size }, () => ({ items: [], spanOf: null }));
	slots[row].items.push({ id, u: 6 });
	return slots;
};

describe("racks", () => {
	it("clamps rack sizes", () => {
		expect(clampSize("20")).toBe(20);
		expect(clampSize(0)).toBe(1);
		expect(clampSize(999)).toBe(60);
		expect(clampSize(12.5)).toBe(13);
		expect(clampSize("abc")).toBeNull();
		expect(clampSize(null)).toBeNull();
	});

	it("migrates an old single-rack save", () => {
		const slots = at("dev", 3, 20);
		slots[0].items.push({ id: "sh", u: 6 });
		const s = normalizeState({
			rackName: "Lab",
			rackSize: 20,
			slots,
			devices: {
				dev: { ...oneU, id: "dev" },
				sh: { ...shelfLib, id: "sh", shelved: [{ ...oneU, id: "pi", u: 3 }] },
			},
		});
		expect(s.racks).toHaveLength(1);
		expect(s.racks[0]).toMatchObject({ name: "Lab", size: 20 });
		expect(s.racks[0].slots).toHaveLength(20);
		expect(findRow(s.racks[0].slots, "dev")).toBe(3);
		expect(findRow(s.racks[0].slots, "sh")).toBe(0);
		expect(s.devices.sh.shelved.map((it) => it.id)).toEqual(["pi"]);
		expect(rackOf(s, "dev")).toBe(s.racks[0].id);
		expect(rackOf(s, "pi")).toBeNull(); // shelved, not rack-placed
		expect(s).not.toHaveProperty("slots");
		expect(s).not.toHaveProperty("rackSize");
		expect(s).not.toHaveProperty("rackName");
	});

	it("loads several racks and the layout", () => {
		const raw = {
			layout: "stack",
			devices: { a: { ...oneU, id: "a" }, b: { ...oneU, id: "b" } },
			racks: [
				{ id: "r1", name: "Big", size: 20, slots: at("a", 15, 20) },
				{ id: "r2", name: "Small", size: 12, slots: at("b", 2) },
			],
		};
		const s = normalizeState(raw);
		expect(s.layout).toBe("stack");
		expect(s.racks.map((r) => [r.id, r.name, r.size])).toEqual([
			["r1", "Big", 20],
			["r2", "Small", 12],
		]);
		expect(findRow(s.racks[0].slots, "a")).toBe(15);
		expect(findRow(s.racks[1].slots, "b")).toBe(2);
		expect(normalizeState({ ...raw, layout: "bogus" }).layout).toBe("side");
	});

	it("a device id placed in two racks is kept only in the first", () => {
		const s = normalizeState({
			devices: { a: { ...oneU, id: "a" } },
			racks: [
				{ id: "r1", name: "A", size: 12, slots: at("a", 1) },
				{ id: "r1", name: "B", size: 12, slots: at("a", 4) },
			],
		});
		expect(findRow(s.racks[0].slots, "a")).toBe(1);
		expect(findRow(s.racks[1].slots, "a")).toBe(-1);
		expect(s.racks[1].id).not.toBe("r1"); // duplicate rack id replaced
	});

	it("no usable racks loads one default 12U rack", () => {
		for (const racks of [[], "x", [null, 5]]) {
			const s = normalizeState({ racks });
			expect(s.racks).toHaveLength(1);
			expect(s.racks[0]).toMatchObject({ name: "Rack 1", size: 12 });
			expect(s.racks[0].slots).toHaveLength(12);
		}
		expect(normalizeState({ racks: [{ size: "abc" }] }).racks[0].size).toBe(12);
	});

	it("rackView / withRackSlots / rackOf / firstFreeSpot round-trip", () => {
		let s = normalizeState({
			devices: { a: { ...oneU, id: "a" } },
			racks: [
				{ id: "r1", size: 1, slots: at("a", 0, 1) },
				{ id: "r2", size: 4, slots: [] },
			],
		});
		expect(rackView(s, "nope")).toBeNull();
		const v = rackView(s, "r2");
		expect(v.rackSize).toBe(4);
		expect(v.slots).toBe(s.racks[1].slots);
		expect(rackOf(s, "a")).toBe("r1");
		expect(rackOf(s, "missing")).toBeNull();

		const dev = { ...oneU, id: "new" };
		expect(firstFreeSpot(s, dev)).toEqual({ rackId: "r2", row: 0 });

		const moved = at("a", 2, 4);
		s = withRackSlots(withRackSlots(v, "r1", rackView(s, "r1").slots.map(() => ({ items: [], spanOf: null }))), "r2", moved);
		expect(s).not.toHaveProperty("slots");
		expect(s).not.toHaveProperty("rackSize");
		expect(rackOf(s, "a")).toBe("r2");
		expect(firstFreeSpot(s, dev)).toEqual({ rackId: "r1", row: 0 });
		expect(mkRack("X", 3).slots).toHaveLength(3);
	});

	describe("crossRackPlan", () => {
		const twoU = { ...oneU, uH: 2 };
		// rack r1 (12U) and r2 (12U); place maps id -> [rackId, row]
		const setup = (devs, place) => {
			const empty = () => Array.from({ length: 12 }, () => ({ items: [], spanOf: null }));
			const slots = { r1: empty(), r2: empty() };
			const devices = {};
			for (const [id, d] of Object.entries(devs)) devices[id] = { ...d, id };
			for (const [id, [rid, row]] of Object.entries(place))
				slots[rid] = placeDeviceInSlots(slots[rid], devices[id], row);
			return normalizeState({
				devices,
				racks: [
					{ id: "r1", name: "A", size: 12, slots: slots.r1 },
					{ id: "r2", name: "B", size: 12, slots: slots.r2 },
				],
			});
		};

		it("moves a single device into an empty spot in another rack", () => {
			const s = setup({ a: oneU }, { a: ["r1", 3] });
			const p = crossRackPlan(s, "r1", "r2", s.devices.a, 7);
			expect(p).toEqual({ kind: "move", moves: [{ id: "a", row: 7 }], row: 7 });
		});

		it("moves a group as one block keeping offsets", () => {
			const s = setup(
				{ a: { ...oneU, groupId: "g" }, b: { ...twoU, groupId: "g" } },
				{ a: ["r1", 0], b: ["r1", 1] },
			);
			const p = crossRackPlan(s, "r1", "r2", s.devices.a, 5);
			expect(p.kind).toBe("move");
			expect(p.moves).toEqual(
				expect.arrayContaining([
					{ id: "a", row: 5 },
					{ id: "b", row: 6 },
				]),
			);
			expect(p.moves).toHaveLength(2);
			// clamped so the 3U block fits the bottom of the target
			expect(crossRackPlan(s, "r1", "r2", s.devices.a, 11).row).toBe(9);
		});

		it("inserts and pushes target devices down when the row is taken", () => {
			const s = setup({ a: oneU, t: twoU }, { a: ["r1", 0], t: ["r2", 4] });
			const p = crossRackPlan(s, "r1", "r2", s.devices.a, 4);
			expect(p.kind).toBe("insert");
			expect(p.moves).toEqual(
				expect.arrayContaining([
					{ id: "a", row: 4 },
					{ id: "t", row: 5 },
				]),
			);
		});

		it("refuses a group that does not fit", () => {
			const devs = { a: { ...twoU, groupId: "g" }, b: { ...twoU, groupId: "g" } };
			const place = { a: ["r1", 0], b: ["r1", 2] };
			for (let i = 0; i < 12; i++) {
				if (i === 4) continue;
				devs[`f${i}`] = oneU;
				place[`f${i}`] = ["r2", i];
			}
			const s = setup(devs, place); // r2 has only one free row (4)
			const before = JSON.stringify(s);
			expect(crossRackPlan(s, "r1", "r2", s.devices.a, 4)).toBeNull();
			expect(JSON.stringify(s)).toBe(before);
			expect(crossRackPlan(s, "r1", "nope", s.devices.a, 4)).toBeNull();
		});
	});
});

import { describe, expect, it } from "vitest";
import { findRow, normalizeState } from "./helpers";
import {
	clampSize,
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
});

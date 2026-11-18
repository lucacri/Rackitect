import { describe, expect, it } from "vitest";
import { normalizeState } from "./helpers";
import { powerText, rackSheet } from "./printSheet";

const state = normalizeState({
	racks: [
		{
			name: "R",
			size: 4,
			slots: [
				{ items: [{ id: "sw", u: 6 }] },
				{ items: [{ id: "shelf", u: 6 }] },
				{ items: [] },
				{ items: [] },
			],
		},
	],
	devices: {
		sw: {
			name: "Switch", cat: "networking", uH: 1, u: 6,
			pwr: { type: "cord", conn: "C13", w: 150 },
			ports: [{ t: "ethernet", n: 24, s: "1GbE" }, { t: "sfp", n: 4, s: "" }],
		},
		shelf: {
			name: "Shelf", cat: "shelf", uH: 1, u: 6,
			pwr: { type: "passive", conn: "", w: 0 }, ports: [],
			shelved: [
				{ id: "mini", name: "Mini PC", cat: "compute", uH: 1, u: 3,
					pwr: { type: "brick", conn: "", w: 65 },
					ports: [{ t: "ethernet", n: 1, s: "1GbE" }] },
			],
		},
	},
});

describe("rackSheet", () => {
	it("lists devices top to bottom with shelved items and totals", () => {
		const s = rackSheet(state, state.racks[0]);
		expect(s.rows.map((r) => [r.u, r.dev.name])).toEqual([[1, "Switch"], [2, "Shelf"]]);
		expect(s.rows[1].shelved.map((d) => d.name)).toEqual(["Mini PC"]);
		expect(s.power).toEqual({ w: 215, bricks: 1, poe: 0, usb: 0 });
		expect(s.outlets).toEqual({ C13: 1 });
		expect(s.ports).toEqual({ "RJ45 1GbE": 25, SFP: 4 });
	});

	it("formats power", () => {
		expect(powerText({ type: "passive", conn: "", w: 0 })).toBe("—");
		expect(powerText({ type: "cord", conn: "C13", w: 150 })).toBe("C13 · 150 W");
	});
});

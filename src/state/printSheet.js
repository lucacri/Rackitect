import { PORT_LBL } from "../data/constants";
import { pwrBadge } from "./helpers";

// What one printed page needs for a rack: the device list top to bottom and the totals
export function rackSheet(state, rack) {
	const rows = [];
	const all = [];
	rack.slots.forEach((slot, i) => {
		for (const it of slot.items) {
			const dev = state.devices[it.id];
			if (!dev) continue;
			const shelved = dev.shelved ?? [];
			rows.push({ u: i + 1, dev, width: it.u, shelved });
			all.push(dev, ...shelved);
		}
	});

	const outlets = {};
	const power = { w: 0, bricks: 0, poe: 0, usb: 0 };
	const ports = {};
	for (const dev of all) {
		power.w += dev.pwr.w;
		if (dev.pwr.type === "cord") {
			const c = dev.pwr.conn || "Outlet";
			outlets[c] = (outlets[c] ?? 0) + 1;
		} else if (dev.pwr.type === "brick") power.bricks++;
		else if (dev.pwr.type === "poe") power.poe++;
		else if (dev.pwr.type === "usb") power.usb++;
		for (const p of dev.ports) {
			const k = `${PORT_LBL[p.t] ?? p.t}${p.s ? " " + p.s : ""}`;
			ports[k] = (ports[k] ?? 0) + p.n;
		}
	}
	return { rows, outlets, power, ports };
}

// "Brick · 65 W", "C13 · 150 W", or "—" for passive gear
export function powerText(pwr) {
	const badge = pwrBadge(pwr);
	if (!badge) return "—";
	return pwr.w ? `${badge} · ${pwr.w} W` : badge;
}

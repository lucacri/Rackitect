import { CAT_COLORS, MAX_U, PORT_LBL } from "../data/constants";
import { useApp } from "../state/AppContext";
import { powerText, rackSheet } from "../state/printSheet";

function portsText(ports) {
	if (!ports.length) return "—";
	return ports
		.map((p) => `${p.n}× ${PORT_LBL[p.t] ?? p.t}${p.s ? " " + p.s : ""}`)
		.join(", ");
}

// Rack drawing: 6 columns per row so half and third width devices sit side by side
function RackDrawing({ rack, devices }) {
	const rowH = Math.min(0.32, 7.4 / rack.size);
	const tiles = [];
	rack.slots.forEach((slot, i) => {
		let col = 1;
		for (const it of slot.items) {
			const dev = devices[it.id];
			if (!dev) continue;
			tiles.push({ dev, row: i + 1, col, w: it.u });
			col += it.u;
		}
	});
	return (
		<div className="ps-rack">
			<div className="ps-unums" style={{ gridTemplateRows: `repeat(${rack.size}, ${rowH}in)` }}>
				{rack.slots.map((_, i) => (
					<span key={i}>{i + 1}</span>
				))}
			</div>
			<div
				className="ps-slots"
				style={{
					gridTemplateRows: `repeat(${rack.size}, ${rowH}in)`,
					gridTemplateColumns: `repeat(${MAX_U}, 1fr)`,
				}}
			>
				{tiles.map(({ dev, row, col, w }) => (
					<div
						key={dev.id}
						className="ps-tile"
						style={{
							gridRow: `${row} / span ${dev.uH}`,
							gridColumn: `${col} / span ${w}`,
							background: CAT_COLORS[dev.cat].bg,
						}}
					>
						{dev.name}
						{dev.shelved?.length ? ` (+${dev.shelved.length})` : ""}
					</div>
				))}
			</div>
		</div>
	);
}

function RackPage({ rack, state }) {
	const { rows, outlets, power, ports } = rackSheet(state, rack);
	const usedU = rack.slots.filter((s) => s.spanOf || s.items.length).length;
	const extras = [
		power.bricks && `${power.bricks} power brick${power.bricks > 1 ? "s" : ""}`,
		power.poe && `${power.poe} on PoE`,
		power.usb && `${power.usb} on USB power`,
	].filter(Boolean);

	return (
		<section className="ps-page">
			<header className="ps-head">
				<div>
					<h1>{rack.name}</h1>
					<p>
						{rack.size}U rack · {usedU}U used · {rack.size - usedU}U free
					</p>
				</div>
				<p className="ps-date">{new Date().toLocaleDateString()}</p>
			</header>

			<div className="ps-top">
				<RackDrawing rack={rack} devices={state.devices} />
				<div className="ps-totals">
					<h2>Power</h2>
					<p className="ps-big">
						{power.w} W
						{state.powerCap > 0 && <small> of {state.powerCap} W budget</small>}
					</p>
					<ul>
						{Object.entries(outlets).map(([conn, n]) => (
							<li key={conn}>
								<b>{n}×</b> {conn} outlet{n > 1 ? "s" : ""} on the PDU / UPS
							</li>
						))}
						{extras.map((e) => (
							<li key={e}>{e}</li>
						))}
						{!Object.keys(outlets).length && !extras.length && <li>No powered devices</li>}
					</ul>
					<h2>Ports</h2>
					<ul>
						{Object.entries(ports).map(([k, n]) => (
							<li key={k}>
								<b>{n}×</b> {k}
							</li>
						))}
						{!Object.keys(ports).length && <li>No ports</li>}
					</ul>
				</div>
			</div>

			<h2>Install checklist (top to bottom)</h2>
			<table className="ps-table">
				<thead>
					<tr>
						<th aria-label="Done" />
						<th>U</th>
						<th>Device</th>
						<th>Power</th>
						<th>Ports</th>
						<th>Notes</th>
					</tr>
				</thead>
				<tbody>
					{rows.flatMap(({ u, dev, width, shelved }) => [
						<tr key={dev.id}>
							<td className="ps-box">☐</td>
							<td>
								{dev.uH > 1 ? `${u}–${u + dev.uH - 1}` : u}
								{width < MAX_U && <small> ({width}/6)</small>}
							</td>
							<td>
								<span className="ps-dot" style={{ background: CAT_COLORS[dev.cat].bg }} />
								{dev.name}
							</td>
							<td>{powerText(dev.pwr)}</td>
							<td>{portsText(dev.ports)}</td>
							<td>{dev.notes}</td>
						</tr>,
						...shelved.map((s) => (
							<tr key={s.id} className="ps-shelved">
								<td className="ps-box">☐</td>
								<td />
								<td>↳ {s.name}</td>
								<td>{powerText(s.pwr)}</td>
								<td>{portsText(s.ports)}</td>
								<td>{s.notes}</td>
							</tr>
						)),
					])}
					{!rows.length && (
						<tr>
							<td colSpan={6}>This rack is empty.</td>
						</tr>
					)}
				</tbody>
			</table>
		</section>
	);
}

// Hidden on screen; the only thing shown when printing (see @media print in App.css)
export default function PrintSheet() {
	const { state } = useApp();
	return (
		<div className="print-sheet">
			{state.racks.map((rack) => (
				<RackPage key={rack.id} rack={rack} state={state} />
			))}
		</div>
	);
}

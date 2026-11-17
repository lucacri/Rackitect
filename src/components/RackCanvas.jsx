import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { useDrag, useModal, useToast } from "../state/UIContext";
import { CAT_COLORS, MAX_RACK, MAX_U, PORT_LBL } from "../data/constants";
import {
	asSelGroup,
	canPlaceOnShelf,
	clampDropRow,
	findRow,
	deviceFromLib,
	getEffectiveLib,
	groupHue,
	groupMembers,
	dropPlan,
	nudgePlan,
	planMoves,
	pwrBadge,
	selectedIds,
} from "../state/helpers";
import {
	clampSize,
	crossRackPlan,
	rackDeviceCount,
	rackOf,
	rackView,
	shrinkLoss,
} from "../state/racks";

// The rack view ({ ...state, slots, rackSize }) of the rack a tile sits in
const RackViewCtx = createContext(null);

// All port groups as a compact string: "24×RJ45 1G · 4×SFP+"
function portDetail(ports) {
	if (!ports?.length) return "";
	return ports
		.slice(0, 3)
		.map((p) => `${p.n}×${PORT_LBL[p.t] ?? p.t}${p.s ? " " + p.s : ""}`)
		.join(" · ");
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Find a shelved device object by id, scanning all shelves */
function findShelved(devices, devId) {
	for (const d of Object.values(devices)) {
		const hit = d.shelved?.find((it) => it.id === devId);
		if (hit) return { dev: hit, shelfId: d.id };
	}
	return null;
}

/** Resolve the dragged device object from any source */
function resolveDragDev(drag, state) {
	if (!drag) return null;
	if (drag.src === "lib") {
		const lib = getEffectiveLib(state).find((l) => l.libId === drag.libId);
		return lib
			? {
					...lib,
					id: "__prev__",
					...(lib.cat === "shelf" ? { shelved: [] } : {}),
				}
			: null;
	}
	if (drag.src === "shelf") {
		return findShelved(state.devices, drag.devId)?.dev ?? null;
	}
	return state.devices[drag.devId] ?? null;
}

const tileUnder = (e) => e.target.closest?.("[data-dev-id]")?.dataset.devId;

// Which of the device's rows the pointer grabbed, so it lands where it looks like it will
function grabRow(e, device) {
	const tile = e.currentTarget.closest(".dev-tile") ?? e.currentTarget;
	const { top, height } = tile.getBoundingClientRect();
	const r = Math.floor(((e.clientY - top) / height) * device.uH);
	return Math.max(0, Math.min(device.uH - 1, r));
}

const DROP_LABEL = {
	move: "Move here",
	reorder: "Move here — others slide up",
	insert: "Insert — others pushed down",
	insertUp: "Insert — others pushed up",
	swap: "Swap",
};

// What visibly moves: the whole shelf when it is dragged by its label strip
const dragEl = (e) =>
	e.currentTarget.classList.contains("shelf-label")
		? e.currentTarget.closest(".dev-tile")
		: e.currentTarget;

// Start a move drag (rack tile, shelf label or shelf item); the source fades until it ends
function startMove(e, setDrag, drag) {
	e.stopPropagation();
	setDrag(drag);
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData("text/plain", drag.devId);
	const el = dragEl(e);
	if (el !== e.currentTarget) {
		const { left, top } = el.getBoundingClientRect();
		e.dataTransfer.setDragImage(el, e.clientX - left, e.clientY - top);
	}
	setTimeout(() => {
		el.style.opacity = ".25";
	}, 0);
}

function endMove(e, setDrag) {
	dragEl(e).style.opacity = "";
	setDrag(null);
}

function startRackDrag(e, setDrag, view, device) {
	startMove(e, setDrag, {
		src: "rack",
		devId: device.id,
		fromRackId: rackOf(view, device.id),
		fromRow: findRow(view.slots, device.id),
		grab: grabRow(e, device),
	});
}

const isAdditive = (e) => e.shiftKey || e.metaKey || e.ctrlKey;

// Click / Enter / Space selects a tile, so tiles work from the keyboard too
function selectProps(device, isSelected, onSelect) {
	const select = (e) => {
		e.stopPropagation();
		onSelect(device.id, isAdditive(e));
	};
	return {
		role: "button",
		tabIndex: 0,
		"aria-pressed": isSelected,
		"aria-label": device.name,
		onClick: select,
		onKeyDown: (e) => {
			if (e.target !== e.currentTarget) return; // keys inside a shelf's items
			if (e.key !== "Enter" && e.key !== " ") return;
			e.preventDefault();
			select(e);
		},
	};
}

// Left offset (in width units) of `id` within row `r`
function xOf(slots, r, id) {
	let x = 0;
	for (const it of slots?.[r]?.items ?? []) {
		if (it.id === id) return x;
		x += it.u;
	}
	return 0;
}

// Group outline for a tile; a lone leftover of a group is not shown as grouped
function groupLook(state, device) {
	if (groupMembers(state, device.groupId).length < 2) return {};
	return {
		cls: "in-group",
		style: { "--grp": `hsl(${groupHue(device.groupId)} 85% 62%)` },
	};
}

const isTyping = (el) =>
	el?.isContentEditable ||
	["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName);

// ── ShelfItem ─────────────────────────────────────────────────────────────────

function ShelfItem({ dev, shelfId, dispatch }) {
	const { setDrag } = useDrag();
	const { bg, fg } = CAT_COLORS[dev.cat] ?? CAT_COLORS.custom;
	const pb = pwrBadge(dev.pwr);

	return (
		<div
			className="shelf-item"
			style={{ flex: dev.u, background: bg, color: fg }}
			draggable
			onDragStart={(e) =>
				startMove(e, setDrag, { src: "shelf", devId: dev.id, shelfId })
			}
			onDragEnd={(e) => endMove(e, setDrag)}
			title={dev.name}
		>
			<span className="shelf-item-name">{dev.name}</span>
			{pb && (
				<span className="dev-badge" style={{ fontSize: 9 }}>
					{pb}
				</span>
			)}
			<button
				className="shelf-item-remove"
				onClick={(e) => {
					e.stopPropagation();
					dispatch({ type: "REMOVE_FROM_SHELF", shelfId, deviceId: dev.id });
				}}
				title="Remove from shelf"
			>
				×
			</button>
		</div>
	);
}

// ── ShelfInner ────────────────────────────────────────────────────────────────

function ShelfInner({ shelf }) {
	const { drag, setDrag } = useDrag();
	const { state, dispatch } = useApp();
	const toast = useToast();

	// Full-width gear and anything that doesn't fit fall through to the rack,
	// so moves, inserts and swaps still work at a shelf's row
	function accepts() {
		const dev = resolveDragDev(drag, state);
		const ignoreId =
			drag?.src === "shelf" && drag.shelfId === shelf.id ? drag.devId : null;
		return !!dev && dev.u < MAX_U && canPlaceOnShelf(shelf, dev, ignoreId);
	}

	function handleDragOver(e) {
		// Bubbles on purpose: the rack reads dropState to hide or show its own preview
		const ok = accepts();
		e.currentTarget.dataset.dropState = ok ? "valid" : "";
		if (!ok) return;
		e.preventDefault();
		// Must be allowed by the drag's effectAllowed ("move" for rack/shelf drags) or the drop never fires
		e.dataTransfer.dropEffect = drag.src === "lib" ? "copy" : "move";
	}

	function handleDragLeave(e) {
		if (!e.currentTarget.contains(e.relatedTarget)) {
			e.currentTarget.dataset.dropState = "";
		}
	}

	function handleDrop(e) {
		e.currentTarget.dataset.dropState = "";
		if (!drag || !accepts()) return; // the rack handles it
		e.preventDefault();
		e.stopPropagation();

		if (drag.src === "lib") {
			const lib = getEffectiveLib(state).find((l) => l.libId === drag.libId);
			if (!lib) return;
			const dev = deviceFromLib(lib);
			if (!canPlaceOnShelf(shelf, dev)) {
				toast("No room on shelf");
				return;
			}
			dispatch({ type: "PLACE_ON_SHELF", shelfId: shelf.id, device: dev });
		} else if (drag.src === "shelf") {
			if (drag.shelfId === shelf.id) {
				setDrag(null);
				return;
			} // same shelf, no-op
			const dev = findShelved(state.devices, drag.devId)?.dev;
			if (!dev || !canPlaceOnShelf(shelf, dev)) {
				toast("No room on shelf");
				return;
			}
			dispatch({
				type: "MOVE_SHELF_ITEM",
				fromShelfId: drag.shelfId,
				toShelfId: shelf.id,
				deviceId: dev.id,
			});
		} else {
			const dev = state.devices[drag.devId];
			if (!dev || !canPlaceOnShelf(shelf, dev)) {
				toast("No room on shelf");
				return;
			}
			dispatch({
				type: "MOVE_DEVICE_TO_SHELF",
				deviceId: dev.id,
				shelfId: shelf.id,
			});
		}

		setDrag(null);
	}

	const usedU = (shelf.shelved ?? []).reduce((s, it) => s + it.u, 0);
	const remain = MAX_U - usedU;

	return (
		<div
			className="shelf-inner"
			data-drop-state=""
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			{(shelf.shelved ?? []).map((it) => (
				<ShelfItem
					key={it.id}
					dev={it}
					shelfId={shelf.id}
					dispatch={dispatch}
				/>
			))}
			{remain > 0 && (
				<div className="shelf-empty-seg" style={{ flex: remain }} />
			)}
		</div>
	);
}

// ── ShelfTile ─────────────────────────────────────────────────────────────────

function ShelfTile({ device, units, isSelected, isDim, isMultiU, onSelect }) {
	const { setDrag } = useDrag();
	const state = useContext(RackViewCtx);
	const grp = groupLook(state, device);

	const cls = [
		"dev-tile",
		"shelf-tile",
		isMultiU && "multi-u-tile",
		isSelected && "is-selected",
		isDim && "is-dim",
		grp.cls,
	]
		.filter(Boolean)
		.join(" ");

	const style = {
		flex: units,
		...grp.style,
		...(isMultiU ? { "--span": device.uH } : {}),
	};

	return (
		<div
			className={cls}
			style={style}
			data-dev-id={device.id}
			{...selectProps(device, isSelected, onSelect)}
			title={device.name}
		>
			{/* Narrow label strip — grab here to drag the whole shelf */}
			<div
				className="shelf-label"
				draggable
				onDragStart={(e) => startRackDrag(e, setDrag, state, device)}
				onDragEnd={(e) => endMove(e, setDrag)}
			>
				{device.name}
			</div>
			<ShelfInner shelf={device} />
		</div>
	);
}

// ── DeviceTile ────────────────────────────────────────────────────────────────

function DeviceTile({ device, units, isSelected, isDim, isMultiU, onSelect }) {
	const { setDrag } = useDrag();
	const state = useContext(RackViewCtx);
	const { bg, fg } = CAT_COLORS[device.cat] ?? CAT_COLORS.custom;
	const pb = pwrBadge(device.pwr);
	const detail = portDetail(device.ports);
	const watts = device.pwr?.w > 0 ? `${device.pwr.w}W` : null;
	const grp = groupLook(state, device);

	const cls = [
		"dev-tile",
		isMultiU && "multi-u-tile",
		isSelected && "is-selected",
		isDim && "is-dim",
		grp.cls,
	]
		.filter(Boolean)
		.join(" ");

	const style = {
		flex: units,
		background: bg,
		color: fg,
		...grp.style,
		...(isMultiU ? { "--span": device.uH } : {}),
	};

	return (
		<div
			className={cls}
			style={style}
			data-dev-id={device.id}
			draggable
			{...selectProps(device, isSelected, onSelect)}
			onDragStart={(e) => startRackDrag(e, setDrag, state, device)}
			onDragEnd={(e) => endMove(e, setDrag)}
			title={device.name}
		>
			{/* Row 1 — always visible */}
			<div className="dev-row1">
				<span className="dev-name">{device.name}</span>
				{pb && <span className="dev-badge">{pb}</span>}
			</div>

			{/* Row 2 — only rendered when row height gives enough space */}
			{(detail || watts) && (
				<div className="dev-row2">
					{detail && <span className="dev-detail">{detail}</span>}
					{watts && <span className="dev-watts">{watts}</span>}
				</div>
			)}
		</div>
	);
}

// ── RackRow ───────────────────────────────────────────────────────────────────

function RackRow({ rowIndex, slot, devices, selIds, dimIds, onSelect }) {
	if (slot.spanOf) {
		return <div className="rack-span" data-row={rowIndex} />;
	}

	const usedUnits = slot.items.reduce((s, it) => s + it.u, 0);
	const remaining = MAX_U - usedUnits;

	return (
		<div
			className="rack-row"
			data-row={rowIndex}
			onClick={() => onSelect(null)}
		>
			{slot.items.map((it) => {
				const dev = devices[it.id];
				if (!dev) return null;
				if (dev.cat === "shelf") {
					return (
						<ShelfTile
							key={dev.id}
							device={dev}
							units={it.u}
							isSelected={selIds.includes(dev.id)}
							isDim={dimIds.has(dev.id)}
							isMultiU={dev.uH > 1}
							onSelect={onSelect}
						/>
					);
				}
				return (
					<DeviceTile
						key={dev.id}
						device={dev}
						units={it.u}
						isSelected={selIds.includes(dev.id)}
						isDim={dimIds.has(dev.id)}
						isMultiU={dev.uH > 1}
						onSelect={onSelect}
					/>
				);
			})}
			{remaining > 0 && (
				<div
					className="empty-seg"
					style={{ flex: remaining }}
					data-row={rowIndex}
				/>
			)}
		</div>
	);
}

// ── RackHeader ────────────────────────────────────────────────────────────────

function RackHeader({ rack }) {
	const { state, dispatch } = useApp();
	const { openConfirm } = useModal();
	// Size applies on Enter or blur, so typing "20" never passes through 2U
	const [draft, setDraft] = useState(String(rack.size));
	useEffect(() => setDraft(String(rack.size)), [rack.size]);

	function applySize() {
		const newSize = clampSize(draft);
		if (newSize === null || newSize === rack.size)
			return setDraft(String(rack.size));
		const atRisk = shrinkLoss(state, rack.id, newSize);
		const doResize = () =>
			dispatch({
				type: "BATCH",
				actions: [
					...atRisk.map((d) => ({ type: "DELETE_DEVICE", deviceId: d.id })),
					{ type: "SET_RACK_SIZE", rackId: rack.id, newSize },
				],
			});
		if (atRisk.length) {
			setDraft(String(rack.size));
			openConfirm(
				`Shrinking "${rack.name}" to ${newSize}U will remove: ${atRisk.map((d) => d.name).join(", ")}. Continue?`,
				doResize,
				{ verb: "Shrink rack" },
			);
		} else {
			setDraft(String(newSize));
			doResize();
		}
	}

	function handleRemove() {
		const n = rackDeviceCount(state, rack.id);
		const remove = () => dispatch({ type: "REMOVE_RACK", rackId: rack.id });
		if (!n) return remove();
		openConfirm(
			`Remove "${rack.name}" and the ${n === 1 ? "device" : `${n} devices`} in it?`,
			remove,
			{ verb: "Remove rack" },
		);
	}

	return (
		<div className="rack-head">
			<input
				className="rack-name-input"
				aria-label="Rack name"
				type="text"
				value={rack.name}
				spellCheck={false}
				autoComplete="off"
				onChange={(e) =>
					dispatch({ type: "SET_RACK_NAME", rackId: rack.id, name: e.target.value })
				}
			/>
			<input
				className="rack-size-input"
				aria-label="Rack size (U)"
				type="number"
				min={1}
				max={MAX_RACK}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={applySize}
				onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
			/>
			<span className="tb-label">U</span>
			<button
				className="btn btn-sm rack-remove"
				onClick={handleRemove}
				disabled={state.racks.length === 1}
				title={
					state.racks.length === 1 ? "The last rack can't be removed" : "Remove rack"
				}
				aria-label={`Remove ${rack.name}`}
			>
				×
			</button>
		</div>
	);
}

// ── RackPanel ─────────────────────────────────────────────────────────────────

function RackPanel({ rack, selIds, onSelect }) {
	const { state, dispatch } = useApp();
	const { drag, setDrag } = useDrag();
	const toast = useToast();
	const [preview, setPreview] = useState(null);
	const previewKey = useRef(null);

	useEffect(() => {
		if (!drag) {
			setPreview(null);
			previewKey.current = null;
		}
	}, [drag]);

	const view = rackView(state, rack.id);
	// A rack drag is planned from its source rack. Dragging one tile of a
	// multi-selection brings the selection's members in that rack.
	const src = drag?.src === "rack" ? rackView(state, drag.fromRackId) : null;
	const srcSel = src ? selIds.filter((id) => findRow(src.slots, id) >= 0) : [];
	const base =
		src && srcSel.length > 1 && srcSel.includes(drag.devId)
			? asSelGroup(src, srcSel)
			: (src ?? view);
	const cross = !!src && drag.fromRackId !== rack.id;
	// The dragged devices as planned, on this rack's rows
	const planState = { ...base, slots: view.slots, rackSize: view.rackSize };

	// Drop target = the whole rack. Row comes from the pointer minus the grabbed row.
	function planFor(e) {
		const dev = resolveDragDev(drag, planState);
		if (!dev) return null;
		const rect = e.currentTarget.getBoundingClientRect();
		const pointer = Math.floor(
			(e.clientY - rect.top) / (rect.height / rack.size),
		);
		const want = pointer - (drag.grab ?? 0);
		if (cross) {
			const row = clampDropRow({ ...base, rackSize: rack.size }, dev, want);
			return { dev, row, plan: crossRackPlan(base, drag.fromRackId, rack.id, dev, want) };
		}
		const row = clampDropRow(planState, dev, want);
		const over = drag.src === "rack" ? tileUnder(e) : null;
		const swapWith = e.altKey ? over : null;
		if (drag.src === "rack" && row === drag.fromRow && !swapWith)
			return { dev, row, same: true };
		// Swap only happens with Alt held, so say so when a swap would work
		const canSwap =
			!e.altKey && !!over && over !== dev.id && !!dropPlan(planState, dev, row, over);
		return { dev, row, plan: dropPlan(planState, dev, row, swapWith), canSwap };
	}

	function showPreview(p) {
		const key = p && JSON.stringify([p.row, p.same, p.plan, p.canSwap]);
		if (key === previewKey.current) return;
		previewKey.current = key;
		setPreview(p);
	}

	function handleDragOver(e) {
		if (!drag) return;
		// A shelf that takes the drop owns it (it marks itself before this runs)
		if (e.target.closest?.(".shelf-inner")?.dataset.dropState === "valid")
			return showPreview(null);
		e.preventDefault();
		const p = planFor(e);
		e.dataTransfer.dropEffect = p?.plan || p?.same
			? drag.src === "lib"
				? "copy"
				: "move"
			: "none";
		showPreview(p);
	}

	function handleDragLeave(e) {
		if (!e.currentTarget.contains(e.relatedTarget)) showPreview(null);
	}

	function handleDrop(e) {
		e.preventDefault();
		const p = drag && planFor(e);
		showPreview(null);
		setDrag(null);
		if (!p || p.same) return;
		const { plan } = p;
		if (!plan) return toast("No room there");
		const rackId = rack.id;

		if (drag.src === "rack") {
			dispatch({ type: "MOVE_DEVICES", rackId, moves: plan.moves });
		} else if (drag.src === "lib") {
			const lib = getEffectiveLib(state).find((l) => l.libId === drag.libId);
			if (!lib) return;
			const device = deviceFromLib(lib);
			dispatch(
				plan.kind === "move"
					? { type: "PLACE_DEVICE", rackId, device, rowIndex: plan.row }
					: { type: "INSERT_DEVICE", rackId, device, rowIndex: plan.row },
			);
		} else if (drag.src === "shelf") {
			const hit = findShelved(state.devices, drag.devId);
			if (!hit) return;
			const { shelfId } = hit;
			const deviceId = hit.dev.id;
			dispatch(
				plan.kind === "move"
					? { type: "MOVE_SHELF_ITEM_TO_RACK", rackId, shelfId, deviceId, rowIndex: plan.row }
					: {
							type: "BATCH",
							actions: [
								{ type: "REMOVE_FROM_SHELF", shelfId, deviceId },
								{ type: "INSERT_DEVICE", rackId, device: hit.dev, rowIndex: plan.row },
							],
						},
			);
		}
	}

	// Outlines of where every affected device will land, at its width and place in the row
	function ghosts() {
		if (!drag || !preview) return null;
		const { dev, row, plan, same, canSwap } = preview;
		const s = planState.devices[dev.id]
			? planState
			: { ...planState, devices: { ...planState.devices, [dev.id]: dev } };
		const slots = plan ? planMoves(s, plan.moves) : same ? view.slots : null;
		const isMain = (id) =>
			id === dev.id || (!!dev.groupId && s.devices[id]?.groupId === dev.groupId);
		const label = same
			? "No change"
			: !plan
				? "No room"
				: DROP_LABEL[plan.kind] + (canSwap ? " · hold Alt (⌥) to swap" : "");
		const items = plan ? plan.moves : [{ id: dev.id, row }];
		return items.map(({ id, row: r }) => {
			const d = s.devices[id];
			const look = same
				? "is-same"
				: !plan
					? "is-invalid"
					: isMain(id)
						? "is-main"
						: "is-moved";
			return (
				<div
					key={id}
					className={"drop-ghost " + look}
					style={{ "--r": r, "--h": d.uH, "--x": xOf(slots, r, id), "--w": d.u }}
				>
					<span>
						{d.name}
						{id === dev.id && ` · ${label}`}
					</span>
				</div>
			);
		});
	}
	// Real tiles that the preview moves elsewhere fade, so the outlines read clearly
	const dimIds = new Set(
		preview?.plan?.moves.map((m) => m.id).filter((id) => id !== drag?.devId),
	);

	return (
		<section className="rack-card" aria-label={rack.name}>
			<RackHeader rack={rack} />
			<div className="rack-outer">
				<div className="u-col">
					{Array.from({ length: rack.size }, (_, i) => (
						<div key={i} className="u-num">
							{i + 1}
						</div>
					))}
				</div>
				<div className="rack-chassis">
					<div className="rack-rail" />
					<div
						className="rack-slots"
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
					>
						<RackViewCtx.Provider value={view}>
							{view.slots.map((slot, i) => (
								<RackRow
									key={i}
									rowIndex={i}
									slot={slot}
									devices={state.devices}
									selIds={selIds}
									dimIds={dimIds}
									onSelect={onSelect}
								/>
							))}
						</RackViewCtx.Provider>
						{ghosts()}
					</div>
					<div className="rack-rail bot" />
				</div>
			</div>
		</section>
	);
}

// ── RackCanvas ────────────────────────────────────────────────────────────────

export default function RackCanvas() {
	const { state, dispatch } = useApp();
	const { openConfirm } = useModal();
	const toast = useToast();
	const selIds = selectedIds(state);

	function handleSelect(id, additive = false) {
		dispatch({ type: "SELECT_DEVICE", deviceId: id, additive });
	}

	// Keyboard shortcuts, ignored while typing or while a dialog is open
	useEffect(() => {
		function onKey(e) {
			if (isTyping(e.target) || document.querySelector("dialog[open]"))
				return;
			const mod = e.metaKey || e.ctrlKey;
			const key = e.key.toLowerCase();
			if (mod && key === "z") {
				e.preventDefault();
				dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
			} else if (mod && key === "y") {
				e.preventDefault();
				dispatch({ type: "REDO" });
			} else if (mod || e.altKey) {
				return;
			} else if ((key === "arrowup" || key === "arrowdown") && selIds.length) {
				e.preventDefault();
				// Nudges stay inside the first selected device's rack
				const rackId = rackOf(state, selIds[0]);
				const view = rackView(state, rackId);
				if (!view) return;
				const ids = selIds.filter((id) => findRow(view.slots, id) >= 0);
				const plan = nudgePlan(view, ids, key === "arrowup" ? -1 : 1);
				if (plan) dispatch({ type: "MOVE_DEVICES", rackId, moves: plan.moves });
			} else if (key === "escape") {
				dispatch({ type: "SELECT_DEVICE", deviceId: null });
			} else if ((key === "delete" || key === "backspace") && selIds.length) {
				e.preventDefault();
				const names = selIds.map((id) => state.devices[id].name);
				openConfirm(
					names.length === 1
						? `Remove "${names[0]}" from the rack?`
						: `Remove ${names.length} devices from the rack?`,
					() =>
						dispatch({
							type: "BATCH",
							actions: selIds.map((id) => ({
								type: "DELETE_DEVICE",
								deviceId: id,
							})),
						}),
					{ verb: "Remove" },
				);
			} else if (key === "g" && selIds.length > 1) {
				const groupId = state.devices[selIds[0]].groupId;
				const oneGroup =
					!!groupId &&
					selIds.every((id) => state.devices[id].groupId === groupId);
				if (oneGroup) dispatch({ type: "UNGROUP", groupId });
				else if (new Set(selIds.map((id) => rackOf(state, id))).size > 1)
					toast("Groups must be in one rack");
				else dispatch({ type: "GROUP_DEVICES", ids: selIds });
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [state, selIds, dispatch, openConfirm, toast]);

	return (
		<main className="panel-center">
			<div className={`racks is-${state.layout}`}>
				{state.racks.map((rack) => (
					<RackPanel
						key={rack.id}
						rack={rack}
						selIds={selIds}
						onSelect={handleSelect}
					/>
				))}
			</div>
		</main>
	);
}

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { useDrag, useModal, useToast } from "../state/UIContext";
import { CAT_COLORS, MAX_U, PORT_LBL } from "../data/constants";
import {
	canPlaceOnShelf,
	clampDropRow,
	findRow,
	deviceFromLib,
	getEffectiveLib,
	groupHue,
	groupMembers,
	dropPlan,
	pwrBadge,
	selectedIds,
} from "../state/helpers";

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

// Start a move drag (rack tile, shelf label or shelf item); the source fades until it ends
function startMove(e, setDrag, drag) {
	e.stopPropagation();
	setDrag(drag);
	e.dataTransfer.effectAllowed = "move";
	e.dataTransfer.setData("text/plain", drag.devId);
	const el = e.target;
	setTimeout(() => {
		el.style.opacity = ".25";
	}, 0);
}

function endMove(e, setDrag) {
	e.target.style.opacity = "";
	setDrag(null);
}

function startRackDrag(e, setDrag, state, device) {
	startMove(e, setDrag, {
		src: "rack",
		devId: device.id,
		fromRow: findRow(state.slots, device.id),
		grab: grabRow(e, device),
	});
}

const isAdditive = (e) => e.shiftKey || e.metaKey || e.ctrlKey;

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

	function dropOk(ignoreId) {
		const dev = resolveDragDev(drag, state);
		return !!dev && canPlaceOnShelf(shelf, dev, ignoreId);
	}

	function handleDragOver(e) {
		e.preventDefault(); // bubbles on purpose: the rack clears its drop preview
		const ignoreId =
			drag?.src === "shelf" && drag.shelfId === shelf.id ? drag.devId : null;
		const ok = dropOk(ignoreId);
		e.currentTarget.dataset.dropState = ok ? "valid" : "invalid";
		// Must be allowed by the drag's effectAllowed ("move" for rack/shelf drags) or the drop never fires
		e.dataTransfer.dropEffect = !ok ? "none" : drag.src === "lib" ? "copy" : "move";
	}

	function handleDragLeave(e) {
		if (!e.currentTarget.contains(e.relatedTarget)) {
			e.currentTarget.dataset.dropState = "";
		}
	}

	function handleDrop(e) {
		e.preventDefault();
		e.stopPropagation();
		e.currentTarget.dataset.dropState = "";
		if (!drag) return;

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

function ShelfTile({ device, units, isSelected, isMultiU, onSelect }) {
	const { setDrag } = useDrag();
	const { state } = useApp();
	const grp = groupLook(state, device);

	const cls = [
		"dev-tile",
		"shelf-tile",
		isMultiU && "multi-u-tile",
		isSelected && "is-selected",
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
			onClick={(e) => {
				e.stopPropagation();
				onSelect(device.id, isAdditive(e));
			}}
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

function DeviceTile({ device, units, isSelected, isMultiU, onSelect }) {
	const { setDrag } = useDrag();
	const { state } = useApp();
	const { bg, fg } = CAT_COLORS[device.cat] ?? CAT_COLORS.custom;
	const pb = pwrBadge(device.pwr);
	const detail = portDetail(device.ports);
	const watts = device.pwr?.w > 0 ? `${device.pwr.w}W` : null;
	const grp = groupLook(state, device);

	const cls = [
		"dev-tile",
		isMultiU && "multi-u-tile",
		isSelected && "is-selected",
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
			onClick={(e) => {
				e.stopPropagation();
				onSelect(device.id, isAdditive(e));
			}}
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

function RackRow({ rowIndex, slot, devices, selIds, onSelect }) {
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

// ── RackCanvas ────────────────────────────────────────────────────────────────

export default function RackCanvas() {
	const { state, dispatch } = useApp();
	const { openConfirm } = useModal();
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

	// Drop target = the whole rack. Row comes from the pointer minus the grabbed row.
	function planFor(e) {
		const dev = resolveDragDev(drag, state);
		if (!dev) return null;
		const rect = e.currentTarget.getBoundingClientRect();
		const pointer = Math.floor(
			(e.clientY - rect.top) / (rect.height / state.rackSize),
		);
		const row = clampDropRow(state, dev, pointer - (drag.grab ?? 0));
		const swapWith = e.altKey && drag.src === "rack" ? tileUnder(e) : null;
		if (drag.src === "rack" && row === drag.fromRow && !swapWith)
			return { dev, row, same: true };
		return { dev, row, plan: dropPlan(state, dev, row, swapWith) };
	}

	function showPreview(p) {
		const key = p && JSON.stringify([p.row, p.same, p.plan]);
		if (key === previewKey.current) return;
		previewKey.current = key;
		setPreview(p);
	}

	function handleDragOver(e) {
		if (!drag) return;
		if (e.target.closest?.(".shelf-inner")) return showPreview(null);
		e.preventDefault();
		const p = planFor(e);
		e.dataTransfer.dropEffect = p?.plan
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

		if (drag.src === "rack") {
			dispatch({ type: "MOVE_DEVICES", moves: plan.moves });
		} else if (drag.src === "lib") {
			const lib = getEffectiveLib(state).find((l) => l.libId === drag.libId);
			if (!lib) return;
			const device = deviceFromLib(lib);
			dispatch(
				plan.kind === "move"
					? { type: "PLACE_DEVICE", device, rowIndex: plan.row }
					: { type: "INSERT_DEVICE", device, rowIndex: plan.row },
			);
		} else if (drag.src === "shelf") {
			const hit = findShelved(state.devices, drag.devId);
			if (!hit) return;
			const { shelfId } = hit;
			const deviceId = hit.dev.id;
			dispatch(
				plan.kind === "move"
					? { type: "MOVE_SHELF_ITEM_TO_RACK", shelfId, deviceId, rowIndex: plan.row }
					: {
							type: "BATCH",
							actions: [
								{ type: "REMOVE_FROM_SHELF", shelfId, deviceId },
								{ type: "INSERT_DEVICE", device: hit.dev, rowIndex: plan.row },
							],
						},
			);
		}
	}

	// Outlines of where every affected device will land
	function ghosts() {
		if (!drag || !preview || preview.same) return null;
		const { dev, row, plan } = preview;
		const isMain = (id) =>
			id === dev.id ||
			(!!dev.groupId && state.devices[id]?.groupId === dev.groupId);
		const items = plan ? plan.moves : [{ id: dev.id, row }];
		return items.map(({ id, row: r }) => {
			const d = state.devices[id] ?? dev;
			const look = !plan ? "is-invalid" : isMain(id) ? "is-main" : "is-moved";
			return (
				<div
					key={id}
					className={"drop-ghost " + look}
					style={{ "--r": r, "--h": d.uH }}
				>
					{id === dev.id && (
						<span>
							{d.name} · {plan ? DROP_LABEL[plan.kind] : "No room"}
						</span>
					)}
				</div>
			);
		});
	}

	function handleSelect(id, additive = false) {
		dispatch({ type: "SELECT_DEVICE", deviceId: id, additive });
	}
	const selIds = selectedIds(state);

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
				);
			} else if (key === "g" && selIds.length > 1) {
				const groupId = state.devices[selIds[0]].groupId;
				const oneGroup =
					!!groupId &&
					selIds.every((id) => state.devices[id].groupId === groupId);
				dispatch(
					oneGroup
						? { type: "UNGROUP", groupId }
						: { type: "GROUP_DEVICES", ids: selIds },
				);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [state.devices, selIds, dispatch, openConfirm]);

	return (
		<main className="panel-center">
			<div className="rack-outer">
				<div className="u-col">
					{Array.from({ length: state.rackSize }, (_, i) => (
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
						{state.slots.map((slot, i) => (
							<RackRow
								key={i}
								rowIndex={i}
								slot={slot}
								devices={state.devices}
								selIds={selIds}
								onSelect={handleSelect}
							/>
						))}
						{ghosts()}
					</div>
					<div className="rack-rail bot" />
				</div>
			</div>
		</main>
	);
}

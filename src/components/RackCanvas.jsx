import { useEffect } from "react";
import { useApp } from "../state/AppContext";
import { useDrag, useModal, useToast } from "../state/UIContext";
import { CAT_COLORS, MAX_U, PORT_LBL } from "../data/constants";
import {
	canPlace,
	canPlaceOnShelf,
	findRow,
	deviceFromLib,
	getEffectiveLib,
	groupHue,
	groupMembers,
	groupMoves,
	insertMoves,
	insertPlan,
	planMoves,
	pwrBadge,
	selectedIds,
	swapMoves,
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

/**
 * Moves for dropping a rack device on `row` (grouped devices move together):
 * a plain move if it fits; otherwise an insert that pushes the devices from `row`
 * down; with `swap` (Option/Alt held) it trades places with the device under
 * the cursor (or the row's only device) instead. Null when nothing applies.
 */
function rackDropMoves(state, devId, row, targetId, swap = false) {
	const dev = state.devices[devId];
	if (!dev) return null;
	const moving =
		groupMembers(state, dev.groupId).length > 1
			? groupMoves(state, devId, row)
			: [{ id: devId, row }];
	if (planMoves(state, moving)) return moving;
	if (!swap) return insertMoves(state, moving);
	if (moving.length > 1) return null;
	const others = state.slots[row].items.filter((it) => it.id !== devId);
	const tid = targetId ?? (others.length === 1 ? others[0].id : null);
	if (!tid || tid === devId) return null;
	if (groupMembers(state, state.devices[tid]?.groupId).length > 1) return null;
	return swapMoves(state, devId, tid);
}

function canRackDrop(state, devId, row, targetId, swap) {
	const moves = rackDropMoves(state, devId, row, targetId, swap);
	return !!moves && !!planMoves(state, moves);
}


const tileUnder = (e) => e.target.closest?.("[data-dev-id]")?.dataset.devId;

// Multi-U tiles overlay the span rows below them (.rack-span ignores the pointer),
// so map the pointer to the rack row it is actually over.
function pointerRow(e, rowIndex, devices) {
	const tile = e.target.closest?.(".multi-u-tile");
	const uH = devices[tile?.dataset.devId]?.uH ?? 1;
	if (uH < 2) return rowIndex;
	const { top, height } = tile.getBoundingClientRect();
	const off = Math.floor(((e.clientY - top) / height) * uH);
	return rowIndex + Math.min(uH - 1, Math.max(0, off));
}
const isAdditive = (e) => e.shiftKey || e.metaKey || e.ctrlKey;

// Highlight the tile a rack drop would swap with (null clears)
function markSwapTarget(id) {
	for (const el of document.querySelectorAll(".swap-target"))
		if (el.dataset.devId !== id) el.classList.remove("swap-target");
	if (id)
		document
			.querySelector(`[data-dev-id="${id}"]`)
			?.classList.add("swap-target");
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

	function handleDragStart(e) {
		e.stopPropagation();
		setDrag({ src: "shelf", devId: dev.id, shelfId });
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", dev.id);
		setTimeout(() => {
			if (e.target) e.target.style.opacity = ".25";
		}, 0);
	}
	function handleDragEnd(e) {
		if (e.target) e.target.style.opacity = "";
		markSwapTarget(null);
		setDrag(null);
	}

	return (
		<div
			className="shelf-item"
			style={{ flex: dev.u, background: bg, color: fg }}
			draggable
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
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

	function previewDev() {
		return resolveDragDev(drag, state);
	}

	function dropOk(ignoreId) {
		if (!drag) return false;
		const dev = previewDev();
		if (!dev) return false;
		if (dev.uH > 1 || dev.cat === "shelf") return false;
		return canPlaceOnShelf(shelf, dev, ignoreId);
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.stopPropagation();
		const ignoreId =
			drag?.src === "shelf" && drag.shelfId === shelf.id ? drag.devId : null;
		const ok = dropOk(ignoreId);
		e.currentTarget.dataset.dropState = ok ? "valid" : "invalid";
		e.dataTransfer.dropEffect = ok ? "copy" : "none";
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

	function handleDragStart(e) {
		const fromRow = findRow(state.slots, device.id);
		setDrag({ src: "rack", devId: device.id, fromRow });
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", device.id);
		setTimeout(() => {
			if (e.target) e.target.style.opacity = ".25";
		}, 0);
	}
	function handleDragEnd(e) {
		if (e.target) e.target.style.opacity = "";
		markSwapTarget(null);
		setDrag(null);
	}

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
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
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

	function handleDragStart(e) {
		e.stopPropagation();
		const fromRow = findRow(state.slots, device.id);
		setDrag({ src: "rack", devId: device.id, fromRow });
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", device.id);
		setTimeout(() => {
			if (e.target) e.target.style.opacity = ".25";
		}, 0);
	}

	function handleDragEnd(e) {
		if (e.target) e.target.style.opacity = "";
		markSwapTarget(null);
		setDrag(null);
	}

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
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
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
	const { drag, setDrag } = useDrag();
	const { state, dispatch } = useApp();
	const toast = useToast();

	function getPreviewDev() {
		return resolveDragDev(drag, state);
	}

	function handleDragOver(e) {
		e.preventDefault();
		const dev = getPreviewDev();
		if (!dev) return;
		const row = pointerRow(e, rowIndex, state.devices);
		const same = drag.src === "rack" && drag.fromRow === row;
		const moves =
			!same && drag.src === "rack"
				? rackDropMoves(state, drag.devId, row, tileUnder(e), e.altKey)
				: null;
		const ok =
			!same &&
			(drag.src === "rack"
				? !!moves && !!planMoves(state, moves)
				: canPlace(state.slots, state.rackSize, row, dev) ||
					!!insertPlan(state, dev, row));
		// Moves that touch devices outside the dragged group are a swap (Alt) or an insert
		const dragGroup = groupMembers(state, dev.groupId);
		const other = moves?.find(
			(m) => m.id !== drag.devId && !dragGroup.includes(m.id),
		);
		const inserting =
			ok &&
			(drag.src === "rack"
				? !!other && !e.altKey
				: !canPlace(state.slots, state.rackSize, row, dev));
		markSwapTarget(ok && e.altKey ? (other?.id ?? null) : null);
		e.currentTarget.dataset.dropState = same
			? ""
			: inserting
				? "insert"
				: ok
					? "valid"
					: "invalid";
		e.dataTransfer.dropEffect = ok ? "copy" : "none";
	}

	function handleDragLeave(e) {
		if (!e.currentTarget.contains(e.relatedTarget)) {
			e.currentTarget.dataset.dropState = "";
			markSwapTarget(null);
		}
	}

	function handleDrop(e) {
		e.preventDefault();
		e.currentTarget.dataset.dropState = "";
		markSwapTarget(null);
		if (!drag) return;
		const row = pointerRow(e, rowIndex, state.devices);

		if (drag.src === "lib") {
			const lib = getEffectiveLib(state).find((l) => l.libId === drag.libId);
			if (!lib) return;
			const dev = deviceFromLib(lib);
			if (canPlace(state.slots, state.rackSize, row, dev)) {
				dispatch({ type: "PLACE_DEVICE", device: dev, rowIndex: row });
			} else if (insertPlan(state, dev, row)) {
				dispatch({ type: "INSERT_DEVICE", device: dev, rowIndex: row });
			} else {
				toast("Cannot place here");
				return;
			}
		} else if (drag.src === "rack") {
			if (drag.fromRow === row) return;
			const targetId = tileUnder(e);
			if (!canRackDrop(state, drag.devId, row, targetId, e.altKey)) {
				toast("Cannot place here");
				return;
			}
			dispatch({
				type: "MOVE_DEVICES",
				moves: rackDropMoves(state, drag.devId, row, targetId, e.altKey),
			});
		} else if (drag.src === "shelf") {
			const hit = findShelved(state.devices, drag.devId);
			if (!hit) return;
			if (!canPlace(state.slots, state.rackSize, row, hit.dev)) {
				toast("Cannot place here");
				return;
			}
			dispatch({
				type: "MOVE_SHELF_ITEM_TO_RACK",
				shelfId: hit.shelfId,
				deviceId: hit.dev.id,
				rowIndex: row,
			});
		}

		setDrag(null);
	}

	if (slot.spanOf) {
		return <div className="rack-span" data-row={rowIndex} />;
	}

	const usedUnits = slot.items.reduce((s, it) => s + it.u, 0);
	const remaining = MAX_U - usedUnits;

	return (
		<div
			className="rack-row"
			data-row={rowIndex}
			data-drop-state=""
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
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
					<div className="rack-slots">
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
					</div>
					<div className="rack-rail bot" />
				</div>
			</div>
		</main>
	);
}

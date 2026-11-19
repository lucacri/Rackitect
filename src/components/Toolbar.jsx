import { useEffect, useRef } from "react";
import { useApp } from "../state/AppContext";
import { useModal } from "../state/UIContext";
import { useToast } from "../state/UIContext";
import { normalizeState } from "../state/helpers";
import { readShareHash, shareUrl } from "../state/share";

export default function Toolbar() {
	const { state, dispatch, canUndo, canRedo, saveError } = useApp();
	const { openDevModal, openConfirm } = useModal();
	const toast = useToast();
	const importRef = useRef(null);
	const rackName = state.racks[0].name;

	useEffect(() => {
		document.title = (rackName || "Rack") + " — Rackitect";
	}, [rackName]);

	// Opened from a share link: offer to load it, then drop the hash so a reload doesn't ask again
	useEffect(() => {
		const hash = location.hash;
		if (!hash.startsWith("#r=")) return;
		// cleared before the async decode, so StrictMode's second run finds nothing
		history.replaceState(null, "", location.pathname + location.search);
		readShareHash(hash)
			.then((shared) => {
				if (!shared) return;
				openConfirm(
					`Load shared "${shared.racks[0].name || "rack"}"? This will replace your current layout.`,
					() => dispatch({ type: "LOAD", payload: shared }),
					{ verb: "Replace layout" },
				);
			})
			.catch(() => {
				toast("Could not read that share link — it may be cut off");
			});
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	async function handleShare() {
		const url = await shareUrl(state);
		try {
			if (navigator.share) return await navigator.share({ title: rackName || "Rack", url });
			await navigator.clipboard.writeText(url);
			toast("Link copied — open it on another device to continue there");
		} catch (err) {
			if (err?.name !== "AbortError") toast("Could not share the link");
		}
	}

	function handleClear() {
		if (!Object.keys(state.devices).length) return;
		openConfirm(
			"Remove all devices from every rack?",
			() => dispatch({ type: "CLEAR_RACK" }),
			{ verb: "Remove all" },
		);
	}

	// ── Export ──────────────────────────────────────────────────────────────────

	function handleExport() {
		const filename =
			(rackName || "rack").replace(/[^a-z0-9_-]/gi, "_") + ".json";
		const json = JSON.stringify(state, null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		toast(`Exported ${filename}`);
	}

	// ── Import ──────────────────────────────────────────────────────────────────

	function handleImportFile(e) {
		const file = e.target.files[0];
		if (!file) return;
		e.target.value = ""; // reset so same file can be re-imported

		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const parsed = normalizeState(JSON.parse(ev.target.result));

				openConfirm(
					`Load "${parsed.racks[0].name || "rack"}"? This will replace your current layout.`,
					() => dispatch({ type: "LOAD", payload: parsed }),
					{ verb: "Replace layout" },
				);
			} catch {
				toast("Could not read file — is it a valid JSON export?");
			}
		};
		reader.readAsText(file);
	}

	return (
		<header className="toolbar">
			<span className="logo">
				Rack<span>itect</span>
			</span>
			<div className="tb-sep" />
			<button
				className="btn btn-sm"
				onClick={() => dispatch({ type: "ADD_RACK" })}
				title="Add a 12U rack"
			>
				+ Rack
			</button>
			<div className="tb-toggle" role="group" aria-label="Rack layout">
				{[
					["side", "Side by side"],
					["stack", "Stacked"],
				].map(([layout, label]) => (
					<button
						key={layout}
						className="btn btn-sm"
						aria-pressed={state.layout === layout}
						onClick={() => dispatch({ type: "SET_LAYOUT", layout })}
					>
						{label}
					</button>
				))}
			</div>
			<div className="tb-spacer" />
			<span
				className={"tb-save" + (saveError ? " is-error" : "")}
				role="status"
				title={
					saveError
						? "Browser storage refused the save — export to keep your work"
						: "Every change is saved in this browser"
				}
			>
				{saveError ? "⚠ Not saved — export" : "✓ Saved"}
			</span>
			<button
				className="btn btn-sm"
				onClick={() => dispatch({ type: "UNDO" })}
				disabled={!canUndo}
				title="Undo (⌘Z / Ctrl+Z)"
			>
				↶ Undo
			</button>
			<button
				className="btn btn-sm"
				onClick={() => dispatch({ type: "REDO" })}
				disabled={!canRedo}
				title="Redo (⇧⌘Z / Ctrl+Y)"
			>
				↷ Redo
			</button>
			<div className="tb-sep" />

			{/* Hidden file input for import */}
			<input
				ref={importRef}
				type="file"
				accept=".json,application/json"
				style={{ display: "none" }}
				onChange={handleImportFile}
			/>

			<button
				className="btn btn-sm"
				onClick={() => importRef.current?.click()}
				title="Import a saved .json layout"
			>
				↑ Import
			</button>
			<button
				className="btn btn-sm"
				onClick={handleExport}
				title="Export layout as .json"
			>
				↓ Export
			</button>
			<button
				className="btn btn-sm"
				onClick={() => window.print()}
				title="Print one letter page per rack, to keep next to you while building"
			>
				⎙ Print
			</button>
			<button
				className="btn btn-sm"
				onClick={handleShare}
				title="Share a link holding this layout — open it on your phone to keep working there"
			>
				⇪ Share
			</button>
			<div className="tb-sep" />
			<button
				className="btn btn-primary btn-sm"
				onClick={() => openDevModal(null)}
			>
				+ New device
			</button>
			<button className="btn btn-sm" onClick={handleClear}>
				Clear all
			</button>
		</header>
	);
}

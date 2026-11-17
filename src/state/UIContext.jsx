import {
	createContext,
	useContext,
	useState,
	useRef,
	useCallback,
} from "react";

// ── Drag context (live drag state shared across the tree) ─────────────────────
const DragCtx = createContext(null);

export function DragProvider({ children }) {
	const [drag, setDrag] = useState(null);
	// drag shape: { src:'lib'|'rack'|'shelf', libId?, devId?, fromRackId?, fromRow?, grab?, shelfId? }
	return (
		<DragCtx.Provider value={{ drag, setDrag }}>{children}</DragCtx.Provider>
	);
}

export function useDrag() {
	return useContext(DragCtx);
}

// ── Modal context ─────────────────────────────────────────────────────────────
const ModalCtx = createContext(null);

export function ModalProvider({ children }) {
	const [devModal, setDevModal] = useState(null); // null | { prefill } (create or edit a library entry)
	const [confirmModal, setConfirmModal] = useState(null); // null | { msg, cb }

	const openDevModal = useCallback(
		(prefill) => setDevModal({ prefill: prefill ?? null }),
		[],
	);
	const closeDevModal = useCallback(() => setDevModal(null), []);

	const openConfirm = useCallback(
		// verb: what the confirm button says ("Remove", "Replace layout"); danger styles it red
		(msg, cb, { verb = "Confirm", danger = true } = {}) =>
			setConfirmModal({ msg, cb, verb, danger }),
		[],
	);
	const closeConfirm = useCallback(() => setConfirmModal(null), []);
	const doConfirm = useCallback(() => {
		confirmModal?.cb();
		setConfirmModal(null);
	}, [confirmModal]);

	return (
		<ModalCtx.Provider
			value={{
				devModal,
				openDevModal,
				closeDevModal,
				confirmModal,
				openConfirm,
				closeConfirm,
				doConfirm,
			}}
		>
			{children}
		</ModalCtx.Provider>
	);
}

export function useModal() {
	return useContext(ModalCtx);
}

// ── Toast context ─────────────────────────────────────────────────────────────
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
	const [msg, setMsg] = useState(null);
	const timer = useRef(null);

	const toast = useCallback((message) => {
		setMsg(message);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setMsg(null), 2600);
	}, []);

	return (
		<ToastCtx.Provider value={toast}>
			{children}
			{/* Always mounted: a live region that appears with its text is often not announced */}
			<div className={"toast" + (msg ? " show" : "")} aria-live="polite">
				{msg}
			</div>
		</ToastCtx.Provider>
	);
}

export function useToast() {
	return useContext(ToastCtx);
}

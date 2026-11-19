import { normalizeState } from "./helpers";

// Layout lives in the URL hash (#r=...): never sent to a server, and gzip keeps it short.
const PREFIX = "#r=";

async function pipe(bytes, stream) {
	return new Uint8Array(
		await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer(),
	);
}

export async function shareUrl(state, base = location.href) {
	const gz = await pipe(new TextEncoder().encode(JSON.stringify(state)), new CompressionStream("gzip"));
	let bin = "";
	for (const b of gz) bin += String.fromCharCode(b); // no spread: big layouts would overflow the call stack
	const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return base.split("#")[0] + PREFIX + b64;
}

// Layout from a share hash, null when there is none. Throws on a broken link.
export async function readShareHash(hash = location.hash) {
	if (!hash.startsWith(PREFIX)) return null;
	const b64 = hash.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
	const gz = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	const json = new TextDecoder().decode(await pipe(gz, new DecompressionStream("gzip")));
	return normalizeState(JSON.parse(json));
}

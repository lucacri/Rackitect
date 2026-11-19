import { expect, it } from "vitest";
import { INIT } from "./AppContext";
import { readShareHash, shareUrl } from "./share";

it("round-trips a layout through a share link", async () => {
	const url = await shareUrl(INIT, "https://x.test/Rackitect/#old");
	expect(url.startsWith("https://x.test/Rackitect/#r=")).toBe(true);
	expect(url.split("#r=")[1]).toMatch(/^[\w-]+$/); // URL-safe
	expect(await readShareHash(url.slice(url.indexOf("#")))).toEqual(INIT);
	expect(await readShareHash("")).toBeNull();
	await expect(readShareHash("#r=abc")).rejects.toThrow();
});

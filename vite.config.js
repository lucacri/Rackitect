import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
	base: "/Rackitect/",
	plugins: [react()],
	test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});

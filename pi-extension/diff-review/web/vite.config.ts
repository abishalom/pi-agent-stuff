import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	root: path.resolve(import.meta.dirname),
	build: {
		outDir: path.resolve(import.meta.dirname, "../static"),
		emptyOutDir: true,
	},
});

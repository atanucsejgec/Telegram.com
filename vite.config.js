import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  base: "./",
  plugins: [
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  define: {
    global: "globalThis",
  },
  server: {
    port: 3000,
  }
});

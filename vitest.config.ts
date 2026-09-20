import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Entegrasyon testleri aynı test veritabanını paylaşır
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

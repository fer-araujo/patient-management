import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      // Runs once in the main process BEFORE any worker is spawned, so every
      // worker starts with TZ=America/Monterrey already in its environment.
      globalSetup: ["./src/test/globalSetup.ts"],
      setupFiles: ["./src/test/setup.ts"],
      clearMocks: true,
      restoreMocks: true,
    },
  }),
);

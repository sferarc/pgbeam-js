import { defineConfig } from "@kubb/core";
import { pluginOas } from "@kubb/plugin-oas";
import { pluginTs } from "@kubb/plugin-ts";

export default defineConfig({
  input: { path: "../../../backend/openapi/bundles/public.yaml" },
  output: {
    path: "./src/generated",
    clean: true,
    barrelType: "named",
    extension: { ".ts": "" },
    // Disable kubb's built-in Prettier — prettier isn't a direct dependency
    // and the intermittent "Prettier not found" failure kills the whole
    // generate pipeline, preventing generate-maps.ts from running.
    // Formatting is handled by biome via the fix-frontend pre-commit hook.
    format: false,
  },
  plugins: [
    pluginOas({ validate: false }),
    pluginTs({
      output: { path: "./types", barrelType: "named" },
      enumType: "asConst",
    }),
  ],
});

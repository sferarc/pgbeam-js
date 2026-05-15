import { adapterOas } from "@kubb/adapter-oas";
import { middlewareBarrel } from "@kubb/middleware-barrel";
import { pluginTs } from "@kubb/plugin-ts";
import { defineConfig } from "kubb";

export default defineConfig({
  root: ".",
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
  // integerType: "number" preserves v4 behavior; v5 defaults int64 to bigint
  // which would require arithmetic-site changes across dashboard/CLI.
  adapter: adapterOas({ validate: false, integerType: "number" }),
  middleware: [middlewareBarrel()],
  plugins: [
    pluginTs({
      output: { path: "./types", barrelType: "named" },
      enumType: "asConst",
    }),
  ],
});

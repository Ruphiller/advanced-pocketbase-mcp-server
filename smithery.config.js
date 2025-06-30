export default {
  esbuild: {
    // Mark Cloudflare Workers specific packages as external for Smithery
    external: [
      "@cloudflare/workers-types",
      "@cloudflare/ai"
    ],
    target: "node18",
    minify: true,
    // Ensure proper handling of ES modules
    format: "esm",
    platform: "node"
  }
}

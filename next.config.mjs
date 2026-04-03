import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Next.js server-side webpack to never bundle these packages.
  // @xenova/transformers → onnxruntime-web → .wasm chunks. Those chunks
  // are only emitted to the CLIENT output directory, but the SERVER
  // webpack-runtime also references them → "Cannot find module ./948.js".
  // Marking them as server-external prevents the server bundle from ever
  // creating those chunk references.
  experimental: {
    serverComponentsExternalPackages: [
      "@xenova/transformers",
      "onnxruntime-web",
      "onnxruntime-node",
      "sharp",
    ],
  },

  webpack: (config, { isServer }) => {
    // Stub onnxruntime-node with a real file (not `false`) so webpack
    // emits a stable named module rather than an anonymous chunk.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-node": path.resolve(
        __dirname,
        "app/lib/onnxruntime-node-stub.js"
      ),
    };

    if (isServer) {
      // Alias embed.js to a server stub so Next.js never bundles
      // @xenova/transformers server-side. Without this, Next.js creates
      // _ssr_app_lib_embed_js.js which references onnxruntime-web WASM
      // chunks that only exist in the client output → "./948.js not found".
      config.resolve.alias[
        path.resolve(__dirname, "app/lib/embed.js")
      ] = path.resolve(__dirname, "app/lib/embed.server.js");
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        "node:fs": false,
        "node:path": false,
      };
    }

    // Null-load native .node binaries on both server and client
    config.module.rules.push({
      test: /\.node$/,
      use: "null-loader",
    });

    return config;
  },
};

export default nextConfig;

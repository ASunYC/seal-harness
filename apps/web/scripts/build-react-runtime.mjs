import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await build({
  entryPoints: [join(root, "scripts", "react-runtime-entry.js")],
  outfile: join(root, "public", "vendor", "react-runtime.mjs"),
  bundle: true,
  format: "esm",
  minify: true,
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
});

await build({
  entryPoints: [join(root, "public", "client-runtime.js")],
  outfile: join(root, "public", "vendor", "client-runtime.mjs"),
  bundle: true,
  format: "esm",
  minify: true,
  platform: "browser",
  target: ["es2022"],
  legalComments: "none",
  plugins: [{
    name: "reuse-host-browser-runtime",
    setup(builder) {
      const bridges = new Map([
        ["react", "react-browser-bridge.js"],
        ["react/jsx-runtime", "react-jsx-browser-bridge.js"],
        ["react-dom", "react-dom-browser-bridge.js"],
        ["react-dom/client", "react-dom-browser-bridge.js"],
      ]);
      builder.onResolve({ filter: /^(?:react|react\/jsx-runtime|react-dom|react-dom\/client)$/ }, (args) => ({ path: join(root, "scripts", bridges.get(args.path)) }));
      builder.onResolve({ filter: /^\/vendor\/react-runtime\.mjs\?/ }, (args) => ({ path: args.path, external: true }));
      builder.onLoad({ filter: /katex[\\/]dist[\\/]katex\.min\.css$/ }, () => ({ contents: "", loader: "css" }));
    },
  }],
});

import path from "path";
import { fileURLToPath } from "url";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";
import process from "process";
import TerserPlugin from "terser-webpack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platform = process.env.PLATFORM || "firefox";
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const buildDir = path.join(rootDir, "build");
const platformDir = path.join(rootDir, "platform", platform);
const WEBLLM_CONNECT_SRC_HOSTS = [
  "https://huggingface.co",
  "https://cdn-lfs.huggingface.co",
  "https://cdn-lfs-us-1.huggingface.co",
  "https://cdn-lfs-us-1.hf.co",
  "https://cas-bridge.xethub.hf.co",
  "https://raw.githubusercontent.com",
];
const WEBLLM_CONNECT_SRC_BASE_SOURCES = ["'self'", "data:"];

function appendConnectSrcDirective(csp) {
  const sources = [
    ...WEBLLM_CONNECT_SRC_BASE_SOURCES,
    ...WEBLLM_CONNECT_SRC_HOSTS,
  ];
  const withoutConnectSrc = csp.replace(/\bconnect-src\b[^;]*;?/gi, "").trim();
  const cspPrefix = withoutConnectSrc.endsWith(";")
    ? withoutConnectSrc
    : `${withoutConnectSrc};`;

  return `${cspPrefix} connect-src ${sources.join(" ")};`;
}

function transformManifestContent(content, includeWebLLMRuntime) {
  if (!includeWebLLMRuntime) {
    return content;
  }

  const manifest = JSON.parse(content.toString());
  const extensionPagesCsp = manifest?.content_security_policy?.extension_pages;

  if (typeof extensionPagesCsp === "string" && extensionPagesCsp.length > 0) {
    manifest.content_security_policy.extension_pages =
      appendConnectSrcDirective(extensionPagesCsp);
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export default (env, argv) => {
  const isDevBuild = argv.mode === "development";
  const isE2EBuild =
    process.env.FT_E2E_BUILD === "1" || process.env.FT_E2E_BUILD === "true";
  const includeWebLLMRuntime = isDevBuild || isE2EBuild;
  const alias = includeWebLLMRuntime
    ? {}
    : {
        "@mlc-ai/web-llm$": path.join(
          srcDir,
          "background",
          "webllm-disabled-runtime.ts",
        ),
      };
  const config = {
    entry: {
      "popup/popup": path.join(srcDir, "popup", "popup.ts"),
      background: path.join(srcDir, "background", "background.ts"),
      content_script: path.join(srcDir, "content-script", "content_script.ts"),
      "third_party/fancier-settings/settings": path.join(
        srcDir,
        "third_party",
        "fancier-settings",
        "settings.js",
      ),
    },
    output: {
      path: buildDir,
      filename: "[name].js",
      clean: true,
      chunkFormat: false,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
      alias,
      fallback: {
        fs: false,
        process: false,
        url: false,
      },
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: ".", to: ".", context: path.join(rootDir, "public") },
          {
            from: ".",
            to: ".",
            context: platformDir,
            globOptions: { ignore: ["**/manifest.json"] },
          },
          {
            from: "manifest.json",
            to: "manifest.json",
            context: platformDir,
            transform(content) {
              return transformManifestContent(content, includeWebLLMRuntime);
            },
          },
        ],
      }),
      new webpack.DefinePlugin({
        __FT_DEV_BUILD__: JSON.stringify(isDevBuild),
        __FT_E2E_BUILD__: JSON.stringify(isE2EBuild),
      }),
      new webpack.ProvidePlugin({
        Buffer: ["buffer", "Buffer"],
      }),
    ],
    performance: {
      maxAssetSize: 67108864,
      maxEntrypointSize: 1048576,
    },
    optimization: {
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              beautify: argv.mode !== "production",
            },
            compress: {
              drop_console: argv.mode === "production",
            },
          },
        }),
      ],
    },
  };

  if (isDevBuild) {
    config.devtool = "source-map";
  }

  return config;
};

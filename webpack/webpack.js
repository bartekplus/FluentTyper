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

export default (env, argv) => {
  const isDevBuild = argv.mode === "development";
  const isE2EBuild =
    process.env.FT_E2E_BUILD === "1" || process.env.FT_E2E_BUILD === "true";
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
          { from: ".", to: ".", context: platformDir },
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

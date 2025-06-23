import path from "path";
import { fileURLToPath } from "url";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";
import process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platform = process.env.PLATFORM || "firefox";
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const buildDir = path.join(rootDir, "build");
const platformDir = path.join(rootDir, "platform", platform);

export default {
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
    },
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: ".", to: ".", context: path.join(rootDir, "public") },
        { from: ".", to: ".", context: platformDir },
      ],
    }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ],
  performance: {
    maxAssetSize: 67108864,
    maxEntrypointSize: 1048576,
  },
};

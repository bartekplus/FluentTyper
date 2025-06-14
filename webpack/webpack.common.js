import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";
import process from "process";

const platform = process.env.PLATFORM || "firefox";
const srcDir = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "src",
);

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
    path: path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../build",
    ),
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
        { from: ".", to: "../build", context: "public" },
        {
          from: path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            `../platform/${platform}`,
          ),
          to: path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            "../build",
          ),
        },
      ],
      options: {},
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

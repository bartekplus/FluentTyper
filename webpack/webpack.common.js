import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import webpack from "webpack";
const srcDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src");

export default {
    entry: {
        'popup/popup': path.join(srcDir, 'popup', 'popup.js'),
        'background': path.join(srcDir, 'background', 'background.js'),
        'content_script': path.join(srcDir, 'content-script', 'content_script.js'),
        'third_party/fancier-settings/settings': path.join(srcDir, 'third_party', 'fancier-settings', 'settings.js'),
    },
    output: {
        path: path.join(path.dirname(new URL(import.meta.url).pathname), "../build"),
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
            "fs": false
        },
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: ".", to: "../build", context: "public" }],
            options: {},
        }),
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
        })
    ],
    performance: {
        maxAssetSize: 67108864,
        maxEntrypointSize: 1048576
    },
};

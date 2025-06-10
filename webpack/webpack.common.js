const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const srcDir = path.join(__dirname, "..", "src");

module.exports = {
    entry: {
        'popup/popup': path.join(srcDir, 'popup', 'popup.js'),
        'background': path.join(srcDir, 'background', 'background.js'),
        'content_script': path.join(srcDir, 'content-script', 'cs.js'),
        'third_party/fancier-settings/settings': path.join(srcDir, 'third_party', 'fancier-settings', 'settings.js'),
    },
    output: {
        path: path.join(__dirname, "../build"),
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
    ],
    performance: {
        maxAssetSize: 67108864
    },
};

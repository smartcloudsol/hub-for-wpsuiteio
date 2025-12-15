const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const webpack = require("webpack");

console.log("PREMIUM BUILD:", process.env.WPSUITE_PREMIUM === "true");

module.exports = function () {
  const config = {
    ...defaultConfig,
    externals: {
      ...defaultConfig.externals,
      "crypto": "WpSuiteWebcrypto",
    },
    plugins: [
      ...defaultConfig.plugins.filter(
        (plugin) => plugin.constructor.name !== "RtlCssPlugin"
      ),
      new webpack.EnvironmentPlugin({
        WPSUITE_PREMIUM: false,
      }),
    ],
  };

  return config;
};

const defaultConfig = require("@wordpress/scripts/config/webpack.config");
const DependencyExtractionWebpackPlugin = require("@wordpress/dependency-extraction-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = function () {
  const config = {
    ...defaultConfig,
    resolve: {
      ...defaultConfig.resolve,
      fallback: {
        crypto: false,
        buffer: false,
        stream: false,
      }
    },
    externals: {
      ...defaultConfig.externals,
      "aws-amplify": "WpSuiteAmplify",
      "aws-amplify/auth": "WpSuiteAmplify",
      "aws-amplify/api": "WpSuiteAmplify",
      "aws-amplify/utils": "WpSuiteAmplify",
      "@aws-amplify/ui": "WpSuiteAmplify",
      "@aws-amplify/ui-react": "WpSuiteAmplify",
      "@aws-amplify/ui-react-core": "WpSuiteAmplify",
      "country-data-list": "WpSuiteAmplify",
      "crypto": "WpSuiteCrypto",
      "jose": "WpSuiteJose",
    },
    optimization: {
      ...defaultConfig.optimization,
      splitChunks: false,
      runtimeChunk: false,
    },
    output: {
      ...defaultConfig.output,
      filename: 'main.js',
      chunkFilename: "[name].js",
    },
    plugins: [
      ...(defaultConfig.plugins
        ? defaultConfig.plugins.filter(
          (plugin) => plugin?.constructor.name !== "RtlCssPlugin" && plugin?.constructor.name !== "DependencyExtractionWebpackPlugin" && plugin?.constructor.name !== "MiniCssExtractPlugin"
        )
        : []),
      new DependencyExtractionWebpackPlugin({
        outputFilename: 'main.asset.php',
      }),
      new MiniCssExtractPlugin({
        filename: 'main.css',
      }),
    ],
  };

  return config;
}

const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro config — the app also bundles raw SVG/JSON asset-library files
 * (assetExts includes svg so bundled icon packs ship as source).
 */
const config = {
  ...getDefaultConfig(__dirname),
};

config.resolver.assetExts.push('svg');

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

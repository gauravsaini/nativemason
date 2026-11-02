module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [[require.resolve('@rn-layout/bridge/babel'), { projectRoot: __dirname }]],
  };
};

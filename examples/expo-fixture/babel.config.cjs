module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [[require.resolve('nativemason/babel'), { projectRoot: __dirname, autoInstrument: true, rootComponent: 'App.tsx', textProbes: true, nativewind: true }]],
  };
};

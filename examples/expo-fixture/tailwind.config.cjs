module.exports = { darkMode: 'class',
  content: ['./App.tsx', './ComplexFlows.tsx', './NativeWindFlow.tsx'],
  presets: [require('nativewind/preset')],
  theme: { extend: { spacing: { comfortable: '16px' } } },
  plugins: [],
};

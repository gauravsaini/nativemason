import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ignores:['**/dist/**','**/node_modules/**','**/.expo/**','artifacts/**','examples/**/android/**']}, js.configs.recommended,...ts.configs.recommended,{files:['**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},{files:['**/*.cjs'],languageOptions:{globals:{module:'readonly',require:'readonly',__dirname:'readonly',process:'readonly'}}},{files:['packages/bridge/src/core/**/*.ts'],rules:{'no-restricted-imports':['error',{patterns:['node:*','playwright','react','react-native','ws','../browser/*','../native/*','../editor/*']}]}});


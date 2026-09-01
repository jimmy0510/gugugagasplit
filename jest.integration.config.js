/**
 * 整合測試設定（會打真正的 Supabase）。
 *
 * 為什麼不能跟單元測試共用 jest-expo preset：那個 preset 會架起
 * React Native 的模擬環境，把 fetch 與 storage 都換掉，
 * supabase-js 在裡面連不出去。這些測試要的是真實網路，所以用純 Node 環境。
 *
 * 跑法：npm run test:sync（需要 .env 裡的 Supabase 設定）
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/data/sync/__tests__/**/*.test.ts'],
  transform: {
    // 只做 TypeScript 型別剝除。不能用 babel-preset-expo——它會在每個檔案
    // 注入 expo/virtual/env 這個 ESM 模組，在 Node 環境下直接語法錯誤。
    // Node 24 本身就懂現代語法，不需要 preset-env 降級。
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: ['@babel/preset-typescript'],
        // Jest 跑的是 CommonJS，import/export 要轉一下
        plugins: ['@babel/plugin-transform-modules-commonjs'],
        babelrc: false,
        configFile: false,
      },
    ],
  },
};

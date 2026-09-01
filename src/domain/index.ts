/**
 * 領域邏輯：所有跟「錢」有關的計算都住在這裡。
 *
 * 這一層刻意不 import 任何 React Native、Expo 或 Supabase 的東西，
 * 所以可以用 Jest 直接秒測，而且 Android App 與網頁版共用同一套計算——
 * 不會出現「手機算出來跟網頁不一樣」。
 */

export * from './money';
export * from './split';
export * from './fx';
export * from './balance';
export * from './settle';

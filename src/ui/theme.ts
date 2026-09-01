import { Platform, useColorScheme } from 'react-native';

/**
 * 低彩度的極簡風格，參照 Apple 的系統介面。
 *
 * 規則：
 * - 淺灰底 + 白卡片分層（iOS grouped list 的作法），不靠邊框描邊
 * - 圓角柔和（12–14），不用陰影
 * - 顏色彩度壓低：主色是灰藍，收付用暗綠與磚紅，都不刺眼
 * - 分隔線極淡且從左側內縮
 * - 數字用 tabular-nums 對齊，不改成打字機字體
 */

interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  line: string;
  lineStrong: string;
  text: string;
  textDim: string;
  signal: string;
  signalText: string;
  signalSoft: string;
  positive: string;
  negative: string;
}

const palette: { light: Colors; dark: Colors } = {
  light: {
    bg: '#F2F2F5',
    surface: '#FFFFFF',
    surfaceAlt: '#E8E8EC',
    line: '#E0E0E5',
    lineStrong: '#C6C6CB',
    text: '#1B1B1F',
    textDim: '#84848C',
    signal: '#5E7A94',
    signalText: '#FFFFFF',
    signalSoft: '#EAEFF4',
    positive: '#5A7D63',
    negative: '#A85F52',
  },
  dark: {
    bg: '#0F0F11',
    surface: '#1B1B1E',
    surfaceAlt: '#26262A',
    line: '#2C2C31',
    lineStrong: '#44444B',
    text: '#F0F0F2',
    textDim: '#8E8E96',
    signal: '#41576B',
    signalText: '#EDF2F7',
    signalSoft: '#1C242B',
    positive: '#8FB398',
    negative: '#D08D7E',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 40,
} as const;

export const radius = { sm: 8, md: 10, lg: 14, pill: 999 } as const;

export const hairline = Platform.OS === 'web' ? 1 : 0.5;
export const maxContentWidth = 640;

/** 數字對齊用等寬字距，但保留系統字型的外觀 */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

export function useTheme(): Colors {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

export type Palette = Colors;

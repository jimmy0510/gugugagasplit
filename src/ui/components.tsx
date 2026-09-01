import { Children, isValidElement, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { hairline, maxContentWidth, radius, spacing, tabularNums, useTheme, type Palette } from './theme';

/**
 * 低彩度極簡元件庫，調性參照 Apple 系統介面。
 *
 * 共同原則：用「淺灰底 + 白卡片」分層而不是描邊，圓角柔和，
 * 顏色只在需要時出現，其餘靠字重與間距建立層次。
 */

/**
 * 用外距而不是 gap 來排版。
 *
 * 為什麼不用 gap：Android 上出現過「按鈕看得到但只有中間一小塊點得到」，
 * 網頁版同一份程式碼卻正常。Android 的觸控會被父容器邊界裁切，
 * 一旦畫面佈局與原生 view 的實際框不一致就會這樣。gap 在新架構下
 * 是相對新的實作，是最可能的來源，所以在版面容器上避開它。
 */
function spaced(children: ReactNode, gapSize: number): ReactNode {
  const items = Children.toArray(children).filter(Boolean);
  return items.map((child, index) =>
    isValidElement(child) && index > 0 ? (
      <View key={child.key ?? index} style={{ marginTop: gapSize }}>
        {child}
      </View>
    ) : (
      child
    ),
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const inner = (
    <View
      style={{
        width: '100%',
        maxWidth: maxContentWidth,
        alignSelf: 'center',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
      }}>
      {spaced(children, spacing.lg)}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      {scroll ? (
        // keyboardShouldPersistTaps="always"：鍵盤開著時點按鈕要直接觸發。
        // 用 "handled" 在 Android 上第一次點常常只會收起鍵盤，
        // 使用者看到的就是「按鈕沒反應」。
        <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

/** 大標題，iOS large title 的比例 */
export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <Text style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.6, color: t.text }}>{children}</Text>
  );
}

/** 區塊小標。不用全大寫，維持柔和 */
export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 13, fontWeight: '500', color: t.textDim }}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: t.text }}>{children}</Text>;
}

export function Body({ children, dim, style }: { children: ReactNode; dim?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[{ fontSize: 15, color: dim ? t.textDim : t.text }, style]}>{children}</Text>;
}

export function Caption({ children, tone }: { children: ReactNode; tone?: 'dim' | 'positive' | 'negative' }) {
  const t = useTheme();
  const color = tone === 'positive' ? t.positive : tone === 'negative' ? t.negative : t.textDim;
  return <Text style={{ fontSize: 13, color, lineHeight: 18 }}>{children}</Text>;
}

/** 金額。用 tabular-nums 讓數字直欄對齊，字型維持系統字 */
export function Mono({
  children,
  size = 15,
  weight = '600',
  tone,
}: {
  children: ReactNode;
  size?: number;
  weight?: '400' | '600' | '700';
  tone?: 'default' | 'negative' | 'positive' | 'dim';
}) {
  const t = useTheme();
  const color =
    tone === 'negative' ? t.negative : tone === 'positive' ? t.positive : tone === 'dim' ? t.textDim : t.text;
  return (
    <Text style={[{ fontSize: size, fontWeight: weight, color, letterSpacing: -0.3 }, tabularNums]}>
      {children}
    </Text>
  );
}

/** 白色圓角卡片，靠與底色的對比分層，不描邊 */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.lg,
        },
        style,
      ]}>
      {spaced(children, spacing.md)}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  const off = disabled || busy;

  // 停用時不要只調透明度——白字壓在半透明主色上會糊掉。
  // 改成中性底 + 灰字，看得出「不能按」也讀得清楚。
  const bg = off
    ? t.surfaceAlt
    : variant === 'primary'
      ? t.signal
      : variant === 'secondary'
        ? t.surfaceAlt
        : 'transparent';
  const fg = off
    ? t.textDim
    : variant === 'primary'
      ? t.signalText
      : variant === 'danger'
        ? t.negative
        : t.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      // 觸控範圍再往外擴 8dp。整個按鈕框本來就該可點，
      // 但實機上回報過「只有文字附近有反應」，多給一圈餘裕，
      // 就算量測到的觸控框與畫出來的框有些微偏移也不會點不到。
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      // Android 的水波紋順便給出「這裡按得到」的視覺回饋，
      // 使用者才看得出可點範圍有多大。
      android_ripple={{ color: 'rgba(127,127,127,0.25)' }}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: radius.md,
        // 停用時同時降低不透明度：只換成灰底灰字，看起來仍像個
        // 可以按的次要按鈕，使用者會以為按鈕壞了。
        opacity: off ? 0.45 : pressed ? 0.65 : 1,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        width: '100%',
        overflow: 'hidden',
      })}>
      {/* 內容一律不吃觸控事件，確保命中的一定是 Pressable 本身 */}
      <View pointerEvents="none" style={{ width: '100%', alignItems: 'center' }}>
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : (
          <Text style={{ color: fg, fontWeight: '600', fontSize: 15, letterSpacing: -0.2 }}>{label}</Text>
        )}
      </View>
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      {label ? <View style={{ marginBottom: spacing.sm }}><Label>{label}</Label></View> : null}
      <TextInput
        placeholderTextColor={t.textDim}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          {
            backgroundColor: t.surfaceAlt,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: focused ? t.signal : 'transparent',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.md,
            fontSize: 17,
            color: t.text,
          },
          // 瀏覽器預設的對焦框是刺眼的黃色，關掉改用上面的邊框
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          props.style as object,
        ]}
      />
      {hint ? <View style={{ marginTop: spacing.sm }}><Caption>{hint}</Caption></View> : null}
    </View>
  );
}

/** iOS 風分段控制：灰色軌道，選中的那格浮成白色 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        backgroundColor: t.surfaceAlt,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
      }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => ({
              flexGrow: 1,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: active ? t.surface : 'transparent',
              alignItems: 'center',
              opacity: pressed ? 0.6 : 1,
            })}>
            <Text
              style={{
                color: active ? t.text : t.textDim,
                fontWeight: active ? '600' : '500',
                fontSize: 14,
                letterSpacing: -0.2,
              }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 極淡分隔線，從左側內縮，模仿 iOS 列表 */
export function Divider({ strong }: { strong?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: hairline,
        backgroundColor: strong ? t.lineStrong : t.line,
        marginLeft: strong ? 0 : spacing.xs,
      }}
    />
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
        style,
      ]}>
      {children}
    </View>
  );
}

/** 提示條：淡色底 + 圓角，不用醒目的警示色 */
export function Banner({ children }: { tone?: 'warn'; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.signalSoft, borderRadius: radius.md, padding: spacing.md }}>
      <Text style={{ color: t.text, fontSize: 13, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xxl, alignItems: 'center', gap: spacing.md }}>
      <ActivityIndicator color={t.textDim} />
      {label ? <Label>{label}</Label> : null}
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.lg,
        paddingVertical: spacing.xl,
        paddingHorizontal: spacing.lg,
        alignItems: 'center',
        gap: spacing.xs,
      }}>
      <Heading>{title}</Heading>
      {hint ? <Caption>{hint}</Caption> : null}
    </View>
  );
}

export type { Palette };

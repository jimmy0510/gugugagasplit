import { Children, Fragment, isValidElement, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

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
export function spaced(children: ReactNode, gapSize: number): ReactNode {
  const items = flatten(children).filter((item) => Boolean(item.node));
  return items.map((item, index) =>
    isValidElement(item.node) && index > 0 ? (
      <View key={item.key} style={{ marginTop: gapSize }}>
        {item.node}
      </View>
    ) : (
      item.node
    ),
  );
}

/**
 * 攤平 Fragment，讓 `{條件 ? <>A B</> : null}` 裡的每一項也拿得到間距。
 *
 * 不攤平的話整個 Fragment 只算一個孩子，裡面的元素之間一點空隙都沒有——
 * 帳號頁的分隔線就這樣直接黏在下一個欄位的標籤上。這種漏掉很難從程式碼看出來，
 * 因為排版看起來完全正常，只有畫面上少了一道間距。
 *
 * key 沿用 Children.toArray 給的那組，Fragment 內的再加上它自己的 key 當前綴，
 * 這樣不同 Fragment 裡的 ".0" 才不會撞在一起，而頂層元素的 key 完全不變
 * （支出列表靠它辨識每一列，換成位置序號會讓刪一筆之後整串重掛）。
 */
function flatten(children: ReactNode, prefix = ''): { node: ReactNode; key: string }[] {
  return Children.toArray(children).flatMap((child, index) => {
    const key = `${prefix}${isValidElement(child) ? (child.key ?? index) : index}`;
    return isValidElement(child) && child.type === Fragment
      ? flatten((child.props as { children?: ReactNode }).children, `${key}/`)
      : [{ node: child, key }];
  });
}

export function Screen({
  children,
  scroll = true,
  /** 釘在最上面、不隨內容捲動的一列（首頁用來放群組切換列） */
  header,
  /** 浮在內容之上、不隨捲動移動的東西（例如 Toast） */
  overlay,
  /**
   * 自己負責避開狀態列。
   *
   * 預設「不要」。有原生標題列的畫面，標題列已經把狀態列的高度讓開了，
   * 這裡再讓一次就會在標題與內容之間多出一整條空白——安全區讀的是整個視窗的
   * 內縮值，它不知道上面已經有人讓過。只有自己畫表頭、沒有原生標題列的畫面
   * （首頁、還沒進導覽器的啟動畫面）才需要打開。
   */
  safeTop = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  header?: ReactNode;
  overlay?: ReactNode;
  safeTop?: boolean;
}) {
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
    <SafeAreaView
      style={{ flex: 1, backgroundColor: t.bg }}
      edges={header || safeTop ? ['top', 'bottom'] : ['bottom']}>
      {header ? (
        // 分隔線要橫貫整個畫面，內容才置中收在 maxContentWidth 裡
        <View style={{ borderBottomWidth: hairline, borderBottomColor: t.line }}>
          <View
            style={{
              width: '100%',
              maxWidth: maxContentWidth,
              alignSelf: 'center',
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
            }}>
            {header}
          </View>
        </View>
      ) : null}
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
      {overlay}
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
        // 不設 width：直排時本來就會自動撐滿，設了反而會在橫排時撐出容器
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

/**
 * 文字連結。用在「切換一個次要區塊」這種場合——
 * 那不是主要動作，用整條按鈕會搶走視覺重心，也容易撐爆橫排容器。
 */
export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: t.signal, fontSize: 14, fontWeight: '600', letterSpacing: -0.2 }}>
        {label}
      </Text>
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

/**
 * 短暫浮出的提示，仿 Android 的 toast：畫面下方一塊淺色圓角，說完就淡出。
 *
 * 用在「做完了，但沒有畫面變化可以佐證」的動作上——例如手動刷新，
 * 沒有這一下的話使用者不知道到底有沒有發生事情。
 */
export function Toast({ message }: { message: string | null }) {
  const t = useTheme();
  // Animated.Value 建立一次就不再變，用 useState 的惰性初始化而不是 ref：
  // render 期間讀 ref 是 React 明文不建議的，lint 也會擋。
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.delay(1300),
      Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [message, opacity]);

  if (!message) return null;

  return (
    <Animated.View
      // 不吃觸控，否則它蓋住的按鈕在這一秒多內都按不到
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: spacing.xxl,
        alignItems: 'center',
        opacity,
      }}>
      <View
        style={{
          backgroundColor: t.lineStrong,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{message}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * 標題列的刷新鍵：圖示加文字，整塊都可以按。
 *
 * 轉圈不是裝飾。手動刷新多半什麼都沒變，沒有這個動畫就完全看不出到底有沒有在做事。
 *
 * 圖示用圖示字型而不是一般的文字符號：一般字的旋轉軸是排版方框的中心，而字的
 * 墨跡並不在方框正中央（左右有側距、又坐在基線上），轉起來會偏心晃動；
 * 圖示字型的字面本來就對齊方框中心，轉起來才是穩的。
 */
/** 轉圈至少要看得見的時間。網頁版的刷新是瞬間完成的，不留一下什麼都看不到。 */
const MIN_SPIN_MS = 600;
const ICON = 24;

export function RefreshButton({ label, onPress }: { label: string; onPress: () => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!busy) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, spin]);

  return (
    <Pressable
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        const startedAt = Date.now();
        try {
          await onPress();
          // 網頁版只是重新查詢，幾毫秒就結束；轉一幀就停等於沒轉過
          const elapsed = Date.now() - startedAt;
          if (elapsed < MIN_SPIN_MS) {
            await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
          }
        } finally {
          setBusy(false);
        }
      }}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: 4,
        opacity: pressed ? 0.5 : 1,
      })}>
      <Animated.View
        style={{
          width: ICON,
          height: ICON,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        }}>
        {/* sync 就是兩個箭頭圍成一圈的那個 */}
        <MaterialIcons name="sync" size={ICON} color={t.signal} />
      </Animated.View>
      <Text style={{ color: t.signal, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 }}>
        {label}
      </Text>
    </Pressable>
  );
}

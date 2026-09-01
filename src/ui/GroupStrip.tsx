import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import type { Group } from '@/data/types';
import { moveItem, offsetOf, shiftFor, slotOf, targetFor } from './reorder';
import { radius, spacing, useTheme } from './theme';

/**
 * 首頁最上方的群組切換列。
 *
 * 橫向捲動選群組，最後接一個「＋」（像瀏覽器的新增分頁），
 * 最右邊固定放頭像通往帳號設定。高度只求「字放得下、點得到」，
 * 因為它下面就是真正的內容——這條列是導覽，不是主角。
 *
 * 長按某個群組可以拖著左右換位置，就像拖 Chrome 的分頁：被拖的那顆
 * 跟著手指走並微微放大，其他顆讓位；放開時滑進新位置。
 */

/** 點擊區至少 34pt 才好按，視覺上又還能維持一條細列 */
const CHIP_HEIGHT = 34;
const GAP = spacing.sm;
/** 讓位與歸位的動畫長度。再長就會顯得拖沓，再短就看不出是「滑過去」 */
const SLIDE_MS = 160;

interface Drag {
  /** 拖曳開始時它在列上的位置 */
  from: number;
  /** 現在放開的話會落在哪個位置 */
  to: number;
}

export function GroupStrip({
  groups,
  selectedId,
  onSelect,
  onReorder,
  onAdd,
  addOpen,
  avatar,
  onAvatarPress,
}: {
  groups: Group[];
  selectedId: string | undefined;
  onSelect: (groupId: string) => void;
  /** 拖曳結束後的新順序（群組 id，由左到右） */
  onReorder: (groupIds: string[]) => void;
  onAdd: () => void;
  addOpen: boolean;
  avatar: React.ReactNode;
  onAvatarPress: () => void;
}) {
  const t = useTheme();

  // 每顆膠囊的寬度。文字長度不一，所以位置只能量出來，不能算出來。
  //
  // 用群組 id 當索引，不能用位置。膠囊的 key 是 id，重排之後 React 只是
  // 把元素換位置、尺寸沒變，onLayout 不會重新觸發——若照位置存，重排一次
  // 之後每顆讀到的都是別人的寬度，第二次拖曳就全歪了。
  const widthById = useRef<Record<string, number>>({});
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const currentWidths = () => groupsRef.current.map((g) => widthById.current[g.id] ?? 0);
  const [drag, setDrag] = useState<Drag | null>(null);
  // PanResponder 的處理函式在建立時就把當下的閉包固定住了，
  // 狀態要另外用 ref 讀，否則拖到一半讀到的都是開始那一刻的舊值。
  const dragRef = useRef<Drag | null>(null);
  const panActive = useRef(false);
  const dragX = useRef(new Animated.Value(0)).current;
  /**
   * 長按當下手指在畫面上的 x。
   *
   * 不能用 PanResponder 的 gesture.dx——它是從「接手觸控的那一刻」開始算的，
   * 而接手發生在長按之後的第一個 move，所以那一段位移不算數，膠囊會落後手指
   * 一小段距離。改成自己記下長按的位置，膠囊就黏在你抓住它的地方。
   */
  const grabX = useRef(0);

  const setDragState = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const finish = () => {
    const current = dragRef.current;
    panActive.current = false;
    if (!current) return;

    const widthsNow = currentWidths();
    if (current.to === current.from) {
      // 沒換位置就滑回原處
      Animated.timing(dragX, { toValue: 0, duration: SLIDE_MS, useNativeDriver: true }).start(() => {
        setDragState(null);
        dragX.setValue(0);
      });
      return;
    }

    // 先滑到新位置再送出新順序：等它已經停在該在的地方才重排，
    // 畫面上就不會有「跳一下」的斷點。
    const delta =
      slotOf(widthsNow, GAP, current.from, current.to) -
      offsetOf(widthsNow, GAP, current.from);
    Animated.timing(dragX, { toValue: delta, duration: SLIDE_MS, useNativeDriver: true }).start(() => {
      onReorder(moveItem(groupsRef.current.map((g) => g.id), current.from, current.to));
      setDragState(null);
      dragX.setValue(0);
    });
  };

  // 處理函式每次 render 都會換新的，但 PanResponder 只建立一次，
  // 所以讓它固定呼叫這個 ref，內容則隨時保持最新。
  const handlers = useRef({ move: (_dx: number) => {}, finish: () => {} });
  handlers.current = {
    move: (dx: number) => {
      const current = dragRef.current;
      if (!current) return;
      dragX.setValue(dx);
      const to = targetFor(currentWidths(), GAP, current.from, dx);
      if (to !== current.to) setDragState({ ...current, to });
    },
    finish,
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // 只有長按啟動之後才接手觸控。用 capture 是為了從膠囊自己的
        // Pressable 手上把觸控搶過來——不然手指一動就變成「按了又放開」。
        onMoveShouldSetPanResponderCapture: () => dragRef.current !== null,
        onPanResponderGrant: () => {
          panActive.current = true;
        },
        onPanResponderMove: (_event, gesture) =>
          handlers.current.move(
            gesture.moveX === 0 ? gesture.dx : gesture.moveX - grabX.current,
          ),
        onPanResponderRelease: () => handlers.current.finish(),
        onPanResponderTerminate: () => handlers.current.finish(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const draggedWidth = drag ? currentWidths()[drag.from] + GAP : 0;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {groups.length === 0 ? (
        // 還沒有任何群組：這條列沒有東西可切，就讓它當標題用。
        // 頭像仍然留著，否則新使用者沒有任何入口能到帳號設定。
        <View style={{ flex: 1, justifyContent: 'center', height: CHIP_HEIGHT }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>gugugagasplit</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          // 拖曳中不能同時捲動，否則手指一動列就跑掉，位置全對不上。
          //
          // 只在原生端這樣做：網頁版的 scrollEnabled={false} 會變成
          // overflow:hidden，而瀏覽器對一個 overflow 轉成 hidden 的元素會把
          // scrollLeft 歸零——群組一多、列本來就捲過一段時，整條列會在拖到
          // 一半時突然跳回最左邊。網頁端靠 responder 自己的 preventDefault 擋。
          scrollEnabled={Platform.OS === 'web' ? true : drag === null}
          style={{ flex: 1 }}
          contentContainerStyle={{ alignItems: 'center', paddingRight: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }} {...responder.panHandlers}>
            {groups.map((group, index) => (
              <Chip
                key={group.id}
                label={group.name}
                active={group.id === selectedId}
                dragging={drag?.from === index}
                shift={shiftFor(index, drag, draggedWidth)}
                dragX={dragX}
                onLayout={(width) => {
                  widthById.current[group.id] = width;
                }}
                onPress={() => onSelect(group.id)}
                onLongPress={(event) => {
                  grabX.current = event.nativeEvent.pageX;
                  setDragState({ from: index, to: index });
                }}
                onPressOut={() => {
                  // 長按了但手指沒動就放開：PanResponder 從沒接手，
                  // 得自己把拖曳狀態收掉，否則整條列會卡在拖曳模式。
                  //
                  // 但不能當場就取消。PanResponder 接手時，RN 是「先終止舊的
                  // responder、才 grant 新的」，所以這裡也會被呼叫一次，而且
                  // 是在 panActive 被設起來之前——當場取消等於每次一動就把
                  // 拖曳掐死。延到下一拍再看它究竟有沒有接手。
                  const armed = dragRef.current;
                  setTimeout(() => {
                    if (!panActive.current && dragRef.current === armed) setDragState(null);
                  }, 0);
                }}
              />
            ))}
          </View>
          <Chip
            label="＋"
            active={addOpen}
            wide={false}
            shift={0}
            dragX={dragX}
            onPress={onAdd}
          />
        </ScrollView>
      )}

      <Pressable
        onPress={onAvatarPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={({ pressed }) => ({
          marginLeft: spacing.sm,
          opacity: pressed ? 0.6 : 1,
          // 靠左一條淡線，讓頭像看起來不屬於捲動區
          borderLeftWidth: 1,
          borderLeftColor: t.line,
          paddingLeft: spacing.md,
        })}>
        {avatar}
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  onLongPress,
  onPressOut,
  onLayout,
  shift,
  dragX,
  dragging = false,
  wide = true,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  onPressOut?: () => void;
  onLayout?: (width: number) => void;
  shift: number;
  dragX: Animated.Value;
  dragging?: boolean;
  wide?: boolean;
}) {
  const t = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: shift,
      duration: SLIDE_MS,
      useNativeDriver: true,
    }).start();
  }, [shift, slide]);

  useEffect(() => {
    Animated.timing(lift, {
      toValue: dragging ? 1 : 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [dragging, lift]);

  return (
    <Animated.View
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.width)}
      style={{
        marginRight: GAP,
        // 手機瀏覽器長按文字會先反藍、跳出複製選單，把長按吃掉，
        // 根本進不了拖曳。整顆膠囊都設成不可選取。
        userSelect: 'none',
        // 被拖的那顆要蓋在其他顆上面，否則讓位時會從旁邊穿過去
        zIndex: dragging ? 2 : 1,
        transform: [
          { translateX: dragging ? dragX : slide },
          { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
        ],
      }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressOut={onPressOut}
        delayLongPress={300}
        android_ripple={{ color: t.lineStrong, borderless: false }}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={({ pressed }) => ({
          height: CHIP_HEIGHT,
          minWidth: wide ? undefined : CHIP_HEIGHT,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: wide ? spacing.lg : 0,
          borderRadius: radius.pill,
          backgroundColor: active ? t.signal : t.surface,
          opacity: pressed && !dragging ? 0.7 : 1,
          userSelect: 'none',
          // 拖起來的那顆浮一層陰影，像被捏起來
          ...(dragging
            ? {
                shadowColor: '#000',
                shadowOpacity: 0.25,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 6,
              }
            : null),
        })}>
        {/* pointerEvents="none"：文字不吃觸控，整顆膠囊都是可按的範圍 */}
        <Text
          pointerEvents="none"
          numberOfLines={1}
          selectable={false}
          style={{
            color: active ? t.signalText : t.textDim,
            fontSize: 14,
            fontWeight: active ? '700' : '500',
            letterSpacing: -0.2,
            userSelect: 'none',
          }}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

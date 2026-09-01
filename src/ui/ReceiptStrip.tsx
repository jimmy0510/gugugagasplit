import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { receiptUrl } from '@/data/receipts';
import type { Receipt } from '@/data/types';
import { Body, Button, Caption, Label, Row } from './components';
import { radius, spacing, useTheme } from './theme';

/**
 * 收據縮圖列。
 *
 * 尚未上傳完成的收據直接顯示本地檔案（localPath），已上傳的則跟
 * Storage 要一組簽章網址——bucket 是私有的，不能用公開網址。
 *
 * 點縮圖會全螢幕放大：收據上的字很小，96px 的縮圖只夠辨識「有這張」，
 * 要真的看內容一定得放大。移除也放在放大檢視裡，不再只靠長按——
 * 長按沒有任何提示，而且原本用的 Alert 在網頁版是完全沒作用的，
 * 等於網頁上根本移除不了。
 */

interface Viewing {
  receiptId: string;
  uri: string;
}

export function ReceiptStrip({
  receipts,
  onAdd,
  onRemove,
  busy,
}: {
  receipts: Receipt[];
  onAdd: (source: 'camera' | 'library') => void;
  onRemove: (receiptId: string) => void;
  busy?: boolean;
}) {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const close = () => {
    setViewing(null);
    setConfirmingRemove(false);
  };

  return (
    <View>
      <Row>
        <Label>收據</Label>
        {receipts.length > 0 ? <Caption>{`${receipts.length} 張 · 點一下放大`}</Caption> : null}
      </Row>

      {receipts.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}>
            {receipts.map((receipt) => (
              <ReceiptThumb
                key={receipt.id}
                receipt={receipt}
                onOpen={(uri) => setViewing({ receiptId: receipt.id, uri })}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <Row>
          <View style={{ flex: 1 }}>
            <Button label="拍收據" variant="secondary" busy={busy} onPress={() => onAdd('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="從相簿選" variant="secondary" busy={busy} onPress={() => onAdd('library')} />
          </View>
        </Row>
      </View>

      <Modal visible={viewing !== null} animationType="fade" onRequestClose={close} transparent={false}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }} edges={['top', 'bottom']}>
          {/* 點畫面任何地方都能關掉——全螢幕看圖時，最直覺的離開方式 */}
          <Pressable style={{ flex: 1 }} onPress={close}>
            <Image
              source={{ uri: viewing?.uri ?? '' }}
              style={{ flex: 1, width: '100%' }}
              contentFit="contain"
            />
          </Pressable>

          <View style={{ padding: spacing.lg }}>
            {confirmingRemove ? (
              <View>
                <Body style={{ color: '#FFFFFF' }}>確定要移除這張收據嗎？</Body>
                <View style={{ marginTop: spacing.md }}>
                  <Row>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="取消"
                        variant="secondary"
                        onPress={() => setConfirmingRemove(false)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="移除"
                        variant="danger"
                        onPress={() => {
                          if (viewing) onRemove(viewing.receiptId);
                          close();
                        }}
                      />
                    </View>
                  </Row>
                </View>
              </View>
            ) : (
              <Row>
                <View style={{ flex: 1 }}>
                  <Button label="關閉" variant="secondary" onPress={close} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="移除這張" variant="danger" onPress={() => setConfirmingRemove(true)} />
                </View>
              </Row>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function ReceiptThumb({ receipt, onOpen }: { receipt: Receipt; onOpen: (uri: string) => void }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(receipt.localPath);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (receipt.localPath) {
      setUri(receipt.localPath);
      return;
    }
    let cancelled = false;
    receiptUrl(receipt.storagePath)
      .then((signed) => {
        if (!cancelled) setUri(signed);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [receipt.localPath, receipt.storagePath]);

  const ready = Boolean(uri) && !failed;

  return (
    <Pressable
      onPress={() => {
        if (ready && uri) onOpen(uri);
      }}
      disabled={!ready}
      style={{ width: 96 }}>
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: radius.md,
          backgroundColor: t.surfaceAlt,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {ready ? (
          <Image source={{ uri: uri! }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Body dim style={{ fontSize: 12 }}>
            {failed ? '載入失敗' : '載入中'}
          </Body>
        )}
      </View>
      {receipt.localPath ? (
        <View style={{ marginTop: spacing.xs }}>
          <Caption>待上傳</Caption>
        </View>
      ) : null}
    </Pressable>
  );
}

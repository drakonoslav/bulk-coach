import React, { useRef, useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Platform,
  Modal,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

interface WheelPickerFieldProps {
  label: string;
  value: string;
  icon: string;
  iconColor: string;
  suffix: string;
  placeholder?: string;
  min: number;
  max: number;
  step: number;
  defaultValue?: number | null;
  onSelect: (v: number) => void;
  onClear?: () => void;
  testID?: string;
}

function decimalsForStep(step: number): number {
  if (step < 0.01) return 3;
  if (step < 0.1) return 2;
  if (step < 1) return 1;
  return 0;
}

function formatVal(v: number, step: number): string {
  return v.toFixed(decimalsForStep(step));
}

function generateItems(min: number, max: number, step: number): number[] {
  const items: number[] = [];
  const dec = decimalsForStep(step);
  for (let v = min; v <= max + step / 2; v += step) {
    items.push(parseFloat(v.toFixed(dec)));
  }
  return items;
}

function findClosestIndex(items: number[], target: number): number {
  let best = 0;
  let bestDist = Math.abs(items[0] - target);
  for (let i = 1; i < items.length; i++) {
    const dist = Math.abs(items[i] - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function WheelColumn({
  items,
  selectedIndex,
  onIndexChange,
  step,
}: {
  items: number[];
  selectedIndex: number;
  onIndexChange: (idx: number) => void;
  step: number;
}) {
  const flatListRef = useRef<FlatList>(null);
  const lastHapticIndex = useRef(-1);
  const isUserScrolling = useRef(false);
  const programmaticScroll = useRef(false);

  useEffect(() => {
    if (programmaticScroll.current) return;
    if (!isUserScrolling.current && flatListRef.current && items.length > 0) {
      programmaticScroll.current = true;
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({
          offset: selectedIndex * ITEM_HEIGHT,
          animated: true,
        });
        setTimeout(() => { programmaticScroll.current = false; }, 300);
      }, 50);
    }
  }, [selectedIndex]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const idx = Math.round(offsetY / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(idx, items.length - 1));
      isUserScrolling.current = false;
      if (clamped !== selectedIndex) {
        onIndexChange(clamped);
      }
    },
    [items.length, onIndexChange, selectedIndex]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const idx = Math.round(offsetY / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(idx, items.length - 1));
      if (clamped !== lastHapticIndex.current) {
        lastHapticIndex.current = clamped;
        if (Platform.OS !== "web") {
          Haptics.selectionAsync();
        }
      }
      if (isUserScrolling.current && clamped !== selectedIndex) {
        onIndexChange(clamped);
      }
    },
    [items.length, onIndexChange, selectedIndex]
  );

  const onBeginDrag = useCallback(() => {
    isUserScrolling.current = true;
    programmaticScroll.current = false;
  }, []);

  const visibleIndex = useRef(selectedIndex);
  visibleIndex.current = selectedIndex;

  const renderItem = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      const distance = Math.abs(index - visibleIndex.current);
      const isCenter = distance === 0;
      const opacity = isCenter ? 1 : distance === 1 ? 0.55 : 0.25;

      return (
        <Pressable
          onPress={() => {
            onIndexChange(index);
            flatListRef.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: true });
          }}
          style={[ws.item, { opacity }]}
        >
          <Text style={[ws.itemText, isCenter && ws.itemTextSelected]}>
            {formatVal(item, step)}
          </Text>
        </Pressable>
      );
    },
    [step, onIndexChange]
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  return (
    <View style={ws.wheelContainer}>
      <View style={ws.selectionHighlight} pointerEvents="none" />
      <FlatList
        ref={flatListRef}
        data={items}
        keyExtractor={(_, i) => i.toString()}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onScrollBeginDrag={onBeginDrag}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: ITEM_HEIGHT * 2,
          paddingBottom: ITEM_HEIGHT * 2,
        }}
        initialScrollIndex={selectedIndex}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={9}
        extraData={selectedIndex}
      />
    </View>
  );
}

export default function WheelPickerField({
  label,
  value,
  icon,
  iconColor,
  suffix,
  placeholder,
  min,
  max,
  step,
  defaultValue,
  onSelect,
  onClear,
  testID,
}: WheelPickerFieldProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [tempIndex, setTempIndex] = useState(0);

  const items = React.useMemo(() => generateItems(min, max, step), [min, max, step]);

  const openModal = useCallback(() => {
    const currentNum = value ? parseFloat(value) : null;
    const startVal = currentNum ?? defaultValue ?? items[Math.floor(items.length / 2)];
    setTempIndex(findClosestIndex(items, startVal));
    setModalVisible(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [value, defaultValue, items]);

  const confirm = useCallback(() => {
    const selected = items[tempIndex];
    onSelect(selected);
    setModalVisible(false);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [items, tempIndex, onSelect]);

  const nudge = useCallback(
    (dir: 1 | -1) => {
      setTempIndex((prev) => Math.max(0, Math.min(prev + dir, items.length - 1)));
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
    },
    [items.length]
  );

  const hasValue = value !== "" && value != null;

  return (
    <>
      <Pressable onPress={openModal} style={ws.fieldRow} testID={testID}>
        <View style={ws.fieldLabel}>
          <Ionicons name={icon as any} size={16} color={iconColor} />
          <Text style={ws.fieldLabelText}>{label}</Text>
        </View>
        <View style={ws.fieldValueRow}>
          {hasValue ? (
            <Text style={ws.fieldValue}>
              {value} <Text style={ws.fieldSuffix}>{suffix}</Text>
            </Text>
          ) : (
            <Text style={ws.fieldPlaceholder}>{placeholder || "Tap to set"}</Text>
          )}
          <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
        </View>
      </Pressable>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={ws.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <Pressable style={ws.modalCard} onPress={() => {}}>
            <View style={ws.modalHeader}>
              <Text style={ws.modalTitle}>{label}</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={Colors.textTertiary} />
              </Pressable>
            </View>

            <View style={ws.modalBody}>
              <Pressable onPress={() => nudge(-1)} style={ws.nudgeBtn}>
                <Ionicons name="remove" size={22} color={Colors.primary} />
              </Pressable>

              <WheelColumn
                items={items}
                selectedIndex={tempIndex}
                onIndexChange={setTempIndex}
                step={step}
              />

              <Pressable onPress={() => nudge(1)} style={ws.nudgeBtn}>
                <Ionicons name="add" size={22} color={Colors.primary} />
              </Pressable>

              <Text style={ws.modalSuffix}>{suffix}</Text>
            </View>

            <Text style={ws.modalPreview}>
              {formatVal(items[tempIndex], step)} {suffix}
            </Text>

            <View style={ws.modalActions}>
              {onClear && hasValue && (
                <Pressable
                  onPress={() => {
                    onClear();
                    setModalVisible(false);
                  }}
                  style={ws.clearBtn}
                >
                  <Text style={ws.clearBtnText}>Clear</Text>
                </Pressable>
              )}
              <Pressable onPress={confirm} style={ws.confirmBtn}>
                <Text style={ws.confirmBtnText}>Set Value</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const ws = StyleSheet.create({
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  fieldLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabelText: {
    fontSize: 13,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  fieldValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  fieldValue: {
    fontSize: 16,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  fieldSuffix: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  fieldPlaceholder: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: "85%",
    maxWidth: 340,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  modalBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  wheelContainer: {
    height: PICKER_HEIGHT,
    width: 110,
    overflow: "hidden",
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  selectionHighlight: {
    position: "absolute",
    top: ITEM_HEIGHT * 2,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    backgroundColor: Colors.primary + "20",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary + "40",
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  itemText: {
    fontSize: 16,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  itemTextSelected: {
    fontSize: 22,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  nudgeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  modalSuffix: {
    fontSize: 16,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  modalPreview: {
    textAlign: "center",
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 10,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  clearBtnText: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontFamily: "Rubik_700Bold",
    color: "#fff",
  },
});

import React, { useRef, useEffect, useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, Pressable, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

interface WheelNumberInputProps {
  value: number | null;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  label?: string;
  defaultValue?: number | null;
}

function generateItems(min: number, max: number, step: number): number[] {
  const items: number[] = [];
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  for (let v = min; v <= max + step / 2; v += step) {
    items.push(parseFloat(v.toFixed(decimals)));
  }
  return items;
}

function formatValue(v: number, step: number): string {
  if (step < 0.1) return v.toFixed(2);
  if (step < 1) return v.toFixed(1);
  return v.toFixed(0);
}

export default function WheelNumberInput({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  label,
  defaultValue,
}: WheelNumberInputProps) {
  const items = React.useMemo(() => generateItems(min, max, step), [min, max, step]);
  const flatListRef = useRef<FlatList>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const lastHapticIndex = useRef(-1);

  const currentValue = value ?? defaultValue ?? items[Math.floor(items.length / 2)];
  const selectedIndex = React.useMemo(() => {
    let best = 0;
    let bestDist = Math.abs(items[0] - currentValue);
    for (let i = 1; i < items.length; i++) {
      const dist = Math.abs(items[i] - currentValue);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }, [items, currentValue]);

  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!initialScrollDone.current && flatListRef.current && items.length > 0) {
      const offset = selectedIndex * ITEM_HEIGHT;
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset, animated: false });
        initialScrollDone.current = true;
      }, 50);
    }
  }, [selectedIndex, items.length]);

  useEffect(() => {
    initialScrollDone.current = false;
  }, [min, max, step]);

  const onMomentumEnd = useCallback(
    (e: any) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const idx = Math.round(offsetY / ITEM_HEIGHT);
      const clampedIdx = Math.max(0, Math.min(idx, items.length - 1));
      if (items[clampedIdx] !== value) {
        onChange(items[clampedIdx]);
      }
      setIsScrolling(false);
    },
    [items, onChange, value]
  );

  const onScroll = useCallback(
    (e: any) => {
      const offsetY = e.nativeEvent.contentOffset.y;
      const idx = Math.round(offsetY / ITEM_HEIGHT);
      if (idx !== lastHapticIndex.current && idx >= 0 && idx < items.length) {
        lastHapticIndex.current = idx;
        if (Platform.OS !== "web") {
          Haptics.selectionAsync();
        }
      }
    },
    [items.length]
  );

  const nudge = useCallback(
    (dir: 1 | -1) => {
      const newIdx = Math.max(0, Math.min(selectedIndex + dir, items.length - 1));
      onChange(items[newIdx]);
      flatListRef.current?.scrollToOffset({ offset: newIdx * ITEM_HEIGHT, animated: true });
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
    },
    [selectedIndex, items, onChange]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      const distance = Math.abs(index - selectedIndex);
      const isSelected = distance === 0;
      const opacity = isSelected ? 1 : distance === 1 ? 0.5 : 0.25;
      const scale = isSelected ? 1 : distance === 1 ? 0.9 : 0.8;

      return (
        <Pressable
          onPress={() => {
            onChange(item);
            flatListRef.current?.scrollToOffset({ offset: index * ITEM_HEIGHT, animated: true });
          }}
          style={[
            wheelStyles.item,
            { opacity, transform: [{ scale }] },
          ]}
        >
          <Text
            style={[
              wheelStyles.itemText,
              isSelected && wheelStyles.itemTextSelected,
            ]}
          >
            {formatValue(item, step)}
          </Text>
        </Pressable>
      );
    },
    [selectedIndex, step, onChange]
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
    <View style={wheelStyles.container}>
      {label && (
        <Text style={wheelStyles.label}>{label}</Text>
      )}
      <View style={wheelStyles.pickerRow}>
        <Pressable onPress={() => nudge(-1)} style={wheelStyles.nudgeBtn}>
          <Text style={wheelStyles.nudgeText}>−</Text>
        </Pressable>

        <View style={wheelStyles.wheelContainer}>
          <View style={wheelStyles.selectionHighlight} pointerEvents="none" />
          <FlatList
            ref={flatListRef}
            data={items}
            keyExtractor={(_, i) => i.toString()}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
            onMomentumScrollEnd={onMomentumEnd}
            onScrollBeginDrag={() => setIsScrolling(true)}
            onScroll={onScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{
              paddingTop: ITEM_HEIGHT * 2,
              paddingBottom: ITEM_HEIGHT * 2,
            }}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
          />
        </View>

        <Pressable onPress={() => nudge(1)} style={wheelStyles.nudgeBtn}>
          <Text style={wheelStyles.nudgeText}>+</Text>
        </Pressable>

        {suffix && (
          <Text style={wheelStyles.suffix}>{suffix}</Text>
        )}
      </View>

      <Text style={wheelStyles.currentValue}>
        {formatValue(currentValue, step)}{suffix ? ` ${suffix}` : ""}
      </Text>
    </View>
  );
}

const wheelStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    marginVertical: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wheelContainer: {
    height: PICKER_HEIGHT,
    width: 100,
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
    fontSize: 20,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  nudgeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  nudgeText: {
    fontSize: 20,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
  },
  suffix: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  currentValue: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    marginTop: 4,
  },
});

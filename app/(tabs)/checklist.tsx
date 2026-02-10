import React from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { DAILY_CHECKLIST, BASELINE } from "@/lib/coaching-engine";

function getTimeCategory(time: string): { icon: string; color: string } {
  const h = parseInt(time.split(":")[0], 10);
  if (h < 6) return { icon: "moon-outline", color: "#818CF8" };
  if (h < 9) return { icon: "sunny-outline", color: Colors.secondary };
  if (h < 12) return { icon: "cafe-outline", color: Colors.primary };
  if (h < 16) return { icon: "barbell-outline", color: "#60A5FA" };
  if (h < 20) return { icon: "flash-outline", color: Colors.success };
  return { icon: "moon-outline", color: "#818CF8" };
}

function ChecklistRow({ time, label, detail, isLast }: { time: string; label: string; detail: string; isLast: boolean }) {
  const cat = getTimeCategory(time);

  return (
    <View style={styles.rowContainer}>
      <View style={styles.timelineCol}>
        <View style={[styles.timelineDot, { backgroundColor: cat.color + "30", borderColor: cat.color }]}>
          <Ionicons name={cat.icon as any} size={14} color={cat.color} />
        </View>
        {!isLast && <View style={[styles.timelineLine, { backgroundColor: cat.color + "20" }]} />}
      </View>
      <View style={[styles.rowCard, !isLast && { marginBottom: 4 }]}>
        <Text style={styles.rowTime}>{time}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
    </View>
  );
}

export default function ChecklistScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: topInset + 16,
            paddingBottom: Platform.OS === "web" ? 84 + 34 : insets.bottom + 100,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Daily Checklist</Text>
          <Text style={styles.subtitle}>Locked meal template</Text>
        </View>

        <View style={styles.macroSummary}>
          <View style={styles.macroItem}>
            <Text style={styles.macroValue}>{BASELINE.calories.toFixed(0)}</Text>
            <Text style={styles.macroLabel}>kcal</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.primary }]}>{BASELINE.proteinG}g</Text>
            <Text style={styles.macroLabel}>protein</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.secondary }]}>{BASELINE.carbsG}g</Text>
            <Text style={styles.macroLabel}>carbs</Text>
          </View>
          <View style={styles.macroDivider} />
          <View style={styles.macroItem}>
            <Text style={[styles.macroValue, { color: Colors.danger }]}>{BASELINE.fatG}g</Text>
            <Text style={styles.macroLabel}>fat</Text>
          </View>
        </View>

        <View style={styles.timeline}>
          {DAILY_CHECKLIST.map((item, i) => (
            <ChecklistRow
              key={`${item.time}-${item.label}`}
              time={item.time}
              label={item.label}
              detail={item.detail}
              isLast={i === DAILY_CHECKLIST.length - 1}
            />
          ))}
        </View>

        <View style={styles.fuelNote}>
          <View style={styles.fuelNoteHeader}>
            <Feather name="zap" size={16} color={Colors.secondary} />
            <Text style={styles.fuelNoteTitle}>Cardio Fuel Guardrail</Text>
          </View>
          <Text style={styles.fuelNoteText}>
            If cardio exceeds {BASELINE.cardioFuel.thresholdMin} min, add +{BASELINE.cardioFuel.addCarbsG}g carbs via{" "}
            {BASELINE.cardioFuel.preferredSource === "dextrin_g" ? "dextrin" : "oats"}.
          </Text>
        </View>

        <View style={styles.ingredientCard}>
          <Text style={styles.ingredientTitle}>Ingredient Amounts</Text>
          {Object.entries(BASELINE.items).map(([key, amount]) => {
            const labels: Record<string, string> = {
              oats_g: "Oats", dextrin_g: "Dextrin", whey_g: "Whey",
              mct_g: "MCT Oil", flax_g: "Flaxseed", yogurt_cups: "Greek Yogurt",
              eggs: "Eggs", bananas: "Bananas",
            };
            const units: Record<string, string> = {
              oats_g: "g", dextrin_g: "g", whey_g: "g", mct_g: "g",
              flax_g: "g", yogurt_cups: "cup", eggs: "", bananas: "",
            };
            return (
              <View key={key} style={styles.ingredientRow}>
                <Text style={styles.ingredientName}>{labels[key] || key}</Text>
                <Text style={styles.ingredientAmount}>{amount}{units[key] ? ` ${units[key]}` : ""}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
  },
  macroSummary: {
    flexDirection: "row",
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: "space-around",
    alignItems: "center",
  },
  macroItem: {
    alignItems: "center",
  },
  macroValue: {
    fontSize: 18,
    fontFamily: "Rubik_700Bold",
    color: Colors.text,
  },
  macroLabel: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
    marginTop: 2,
  },
  macroDivider: {
    width: 1,
    height: 30,
    backgroundColor: Colors.border,
  },
  timeline: {
    marginBottom: 20,
  },
  rowContainer: {
    flexDirection: "row",
  },
  timelineCol: {
    width: 40,
    alignItems: "center",
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 12,
  },
  rowCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginLeft: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowTime: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.primary,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  rowLabel: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 3,
  },
  rowDetail: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  fuelNote: {
    backgroundColor: Colors.secondaryMuted,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.secondary + "30",
  },
  fuelNoteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  fuelNoteTitle: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.secondary,
  },
  fuelNoteText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  ingredientCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  ingredientTitle: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
    marginBottom: 12,
  },
  ingredientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  ingredientName: {
    fontSize: 14,
    fontFamily: "Rubik_500Medium",
    color: Colors.textSecondary,
  },
  ingredientAmount: {
    fontSize: 14,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
});

import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { Ionicons, Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { fmtInt, fmtVal, fmtFracToPctInt } from "@/lib/format";

type ContextPhase =
  | "NOVELTY_DISTURBANCE"
  | "ADAPTIVE_STABILIZATION"
  | "CHRONIC_SUPPRESSION"
  | "INSUFFICIENT_DATA";

interface PhaseResult {
  phase: ContextPhase;
  confidence: number;
  summary: string;
  metrics: {
    disturbanceScore: number;
    disturbanceSlope14d: number;
    taggedDays: number;
    adjustmentAttempted: boolean;
    cortisolFlagRate: number | null;
  };
  disturbance: {
    score: number;
    reasons: string[];
    components: {
      hrv: number;
      rhr: number;
      slp: number;
      prx: number;
      drf: number;
      lateRate: number | null;
    };
  };
}

interface ContextEvent {
  id: number;
  day: string;
  tag: string;
  intensity: number;
  notes: string | null;
  adjustmentAttempted: boolean;
}

const PHASE_CONFIG: Record<ContextPhase, { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  NOVELTY_DISTURBANCE: { label: "Novelty", color: "#F59E0B", bg: "#F59E0B20", icon: "flash" },
  ADAPTIVE_STABILIZATION: { label: "Stabilizing", color: "#34D399", bg: "#34D39920", icon: "trending-down" },
  CHRONIC_SUPPRESSION: { label: "Chronic", color: "#F87171", bg: "#F8717120", icon: "warning" },
  INSUFFICIENT_DATA: { label: "Needs Data", color: "#94A3B8", bg: "#94A3B820", icon: "time" },
};

const PRESET_TAGS = ["travel", "illness", "stress", "alcohol", "poor sleep", "overtraining", "social", "fasting"];

export default function ContextLensCard() {
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [lensResult, setLensResult] = useState<PhaseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTagEntry, setShowTagEntry] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [expanded, setExpanded] = useState(false);

  const baseUrl = getApiUrl();

  const fetchTags = useCallback(async () => {
    try {
      const res = await authFetch(new URL("/api/context-events/tags", baseUrl).toString());
      if (res.ok) {
        const data = await res.json();
        setTags(data.tags || []);
      }
    } catch {}
  }, [baseUrl]);

  useEffect(() => { fetchTags(); }, [fetchTags]);

  const selectTag = useCallback(async (tag: string) => {
    setSelectedTag(tag);
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await authFetch(
        new URL(`/api/context-lens?tag=${encodeURIComponent(tag)}&date=${today}`, baseUrl).toString(),
      );
      if (res.ok) {
        const data = await res.json();
        setLensResult(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const logToday = useCallback(async (tag: string) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await authFetch(new URL("/api/context-events", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: today, tag, intensity: 1 }),
      });
      if (res.ok) {
        fetchTags();
        selectTag(tag);
      }
    } catch {}
  }, [baseUrl, fetchTags, selectTag]);

  const addNewTag = useCallback(async () => {
    const tag = newTag.trim().toLowerCase();
    if (!tag) return;
    setNewTag("");
    setShowTagEntry(false);
    await logToday(tag);
  }, [newTag, logToday]);

  const markAdjustment = useCallback(async () => {
    if (!selectedTag) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      await authFetch(new URL("/api/context-events/adjustment", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: selectedTag, day: today }),
      });
      selectTag(selectedTag);
    } catch {}
  }, [baseUrl, selectedTag, selectTag]);

  const slopeArrow = (slope: number) => {
    if (slope <= -2) return { icon: "trending-down" as const, color: "#34D399" };
    if (slope >= 2) return { icon: "trending-up" as const, color: "#F87171" };
    return { icon: "remove" as const, color: "#94A3B8" };
  };

  const scoreColor = (score: number) => {
    if (score >= 70) return "#F87171";
    if (score >= 62) return "#F59E0B";
    if (score >= 56) return "#FCD34D";
    return "#34D399";
  };

  const scoreLabel = (score: number) => {
    if (score >= 60) return "High disturbance";
    if (score >= 40) return "Moderate";
    if (score >= 20) return "Mild";
    return "Minimal";
  };

  const allTags = Array.from(new Set([...tags, ...PRESET_TAGS]));
  const activeTags = tags;

  return (
    <View testID="context-lens" style={s.container}>
      <Pressable onPress={() => setExpanded(!expanded)} style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name="prism" size={18} color="#8B5CF6" />
          <Text style={s.title}>Context Lens</Text>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={Colors.textSecondary}
        />
      </Pressable>

      {expanded && (
        <View style={s.body}>
          <View style={s.tagRow}>
            {allTags.map((t) => {
              const active = activeTags.includes(t);
              const sel = t === selectedTag;
              return (
                <Pressable
                  key={t}
                  onPress={() => active ? selectTag(t) : logToday(t)}
                  onLongPress={() => active ? logToday(t) : undefined}
                  style={[
                    s.tagChip,
                    active && s.tagChipActive,
                    sel && s.tagChipSelected,
                  ]}
                >
                  <Text style={[
                    s.tagText,
                    active && s.tagTextActive,
                    sel && s.tagTextSelected,
                  ]}>
                    {t}
                  </Text>
                  {!active && (
                    <Ionicons name="add-circle-outline" size={12} color={Colors.textTertiary} />
                  )}
                </Pressable>
              );
            })}
            <Pressable onPress={() => setShowTagEntry(!showTagEntry)} style={s.addTagBtn}>
              <Ionicons name="add" size={16} color={Colors.primary} />
            </Pressable>
          </View>

          {showTagEntry && (
            <View style={s.tagEntryRow}>
              <TextInput
                style={s.tagInput}
                value={newTag}
                onChangeText={setNewTag}
                placeholder="custom tag..."
                placeholderTextColor={Colors.textTertiary}
                onSubmitEditing={addNewTag}
                autoFocus
              />
              <Pressable onPress={addNewTag} style={s.tagSubmitBtn}>
                <Text style={s.tagSubmitText}>Add</Text>
              </Pressable>
            </View>
          )}

          {loading && (
            <Text style={s.loadingText}>Analyzing...</Text>
          )}

          {!loading && lensResult && selectedTag && (
            <View style={s.resultCard}>
              <View style={s.resultHeader}>
                <View style={[s.phaseBadge, { backgroundColor: PHASE_CONFIG[lensResult.phase].bg }]}>
                  <Ionicons
                    name={PHASE_CONFIG[lensResult.phase].icon}
                    size={14}
                    color={PHASE_CONFIG[lensResult.phase].color}
                  />
                  <Text style={[s.phaseBadgeText, { color: PHASE_CONFIG[lensResult.phase].color }]}>
                    {PHASE_CONFIG[lensResult.phase].label}
                  </Text>
                </View>

                <View style={s.scoreBox}>
                  <Text style={[s.scoreValue, { color: scoreColor(lensResult.metrics.disturbanceScore) }]}>
                    {fmtInt(lensResult.metrics.disturbanceScore)}
                  </Text>
                  <Text style={s.scoreLabelText}>{scoreLabel(lensResult.metrics.disturbanceScore)}</Text>
                </View>

                {lensResult.metrics.disturbanceSlope14d !== 0 && (
                  <View style={s.slopeBox}>
                    <Ionicons
                      name={slopeArrow(lensResult.metrics.disturbanceSlope14d).icon}
                      size={16}
                      color={slopeArrow(lensResult.metrics.disturbanceSlope14d).color}
                    />
                    <Text style={[s.slopeText, { color: slopeArrow(lensResult.metrics.disturbanceSlope14d).color }]}>
                      {lensResult.metrics.disturbanceSlope14d > 0 ? "+" : ""}
                      {fmtVal(lensResult.metrics.disturbanceSlope14d, 1)}/wk
                    </Text>
                  </View>
                )}
              </View>

              <Text style={s.summaryText}>{lensResult.summary}</Text>

              <View style={s.metaRow}>
                <Text style={s.metaItem}>
                  {lensResult.metrics.taggedDays} tagged day{lensResult.metrics.taggedDays !== 1 ? "s" : ""}
                </Text>
                <Text style={s.metaDot}>·</Text>
                <Text style={s.metaItem}>
                  {lensResult.confidence}% conf
                </Text>
                {lensResult.metrics.cortisolFlagRate != null && lensResult.metrics.cortisolFlagRate > 0 && (
                  <>
                    <Text style={s.metaDot}>·</Text>
                    <Text style={[s.metaItem, lensResult.metrics.cortisolFlagRate >= 0.3 ? { color: "#F87171" } : {}]}>
                      cortisol {fmtFracToPctInt(lensResult.metrics.cortisolFlagRate)}
                    </Text>
                  </>
                )}
              </View>

              {lensResult.phase !== "INSUFFICIENT_DATA" && (
                <View style={s.componentRow}>
                  {(["hrv", "rhr", "slp", "prx", "drf"] as const).map((k) => {
                    const val = lensResult.disturbance.components[k];
                    const pct = Math.min(100, Math.round(Math.abs(val) * 100));
                    const labels = { hrv: "HRV", rhr: "RHR", slp: "SLP", prx: "PRX", drf: "DRF" };
                    const barColor = val > 0.3 ? "#F87171" : val > 0 ? "#F59E0B" : "#34D399";
                    return (
                      <View key={k} style={s.compItem}>
                        <Text style={s.compLabel}>{labels[k]}</Text>
                        <View style={[s.compBar, { opacity: Math.min(1, Math.abs(val) + 0.15) }]}>
                          <View style={[
                            s.compFill,
                            {
                              width: `${pct}%`,
                              backgroundColor: barColor,
                            },
                          ]} />
                        </View>
                        <Text style={[s.compPct, { color: barColor }]}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {lensResult.phase === "NOVELTY_DISTURBANCE" && !lensResult.metrics.adjustmentAttempted && (
                <Pressable onPress={markAdjustment} style={s.adjustBtn}>
                  <Feather name="check-circle" size={14} color={Colors.primary} />
                  <Text style={s.adjustBtnText}>Mark Adjustment Attempted</Text>
                </Pressable>
              )}

              {lensResult.metrics.adjustmentAttempted && (
                <View style={s.adjustedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#34D399" />
                  <Text style={s.adjustedText}>Adjustment recorded</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.text,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: Colors.cardBgElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagChipActive: {
    borderColor: "#8B5CF640",
  },
  tagChipSelected: {
    backgroundColor: "#8B5CF620",
    borderColor: "#8B5CF6",
  },
  tagText: {
    fontSize: 12,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  tagTextActive: {
    color: Colors.textSecondary,
  },
  tagTextSelected: {
    color: "#8B5CF6",
    fontFamily: "Rubik_600SemiBold",
  },
  addTagBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.cardBgElevated,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagEntryRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  tagInput: {
    flex: 1,
    backgroundColor: Colors.cardBgElevated,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#8B5CF6",
  },
  tagSubmitText: {
    fontSize: 13,
    fontFamily: "Rubik_600SemiBold",
    color: "#FFFFFF",
  },
  loadingText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    textAlign: "center",
    paddingVertical: 8,
  },
  resultCard: {
    backgroundColor: Colors.cardBgElevated,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  phaseBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  phaseBadgeText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
  },
  scoreBox: {
    alignItems: "center",
  },
  scoreValue: {
    fontSize: 18,
    fontFamily: "Rubik_700Bold",
  },
  scoreLabelText: {
    fontSize: 9,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
    letterSpacing: 0.3,
  },
  slopeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  slopeText: {
    fontSize: 12,
    fontFamily: "Rubik_600SemiBold",
  },
  summaryText: {
    fontSize: 13,
    fontFamily: "Rubik_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaItem: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: Colors.textTertiary,
  },
  metaDot: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  componentRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  compItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  compLabel: {
    fontSize: 9,
    fontFamily: "Rubik_600SemiBold",
    color: Colors.textTertiary,
    letterSpacing: 0.5,
  },
  compBar: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  compFill: {
    height: "100%",
    borderRadius: 2,
  },
  compPct: {
    fontSize: 8,
    fontFamily: "Rubik_500Medium",
    marginTop: 1,
  },
  adjustBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignSelf: "flex-start",
  },
  adjustBtnText: {
    fontSize: 12,
    fontFamily: "Rubik_500Medium",
    color: Colors.primary,
  },
  adjustedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  adjustedText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: "#34D399",
  },
});

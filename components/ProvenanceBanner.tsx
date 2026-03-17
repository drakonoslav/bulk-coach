/**
 * ProvenanceBanner
 *
 * Floating debug panel that shows the exact source-of-truth for the current
 * session: database env, user_id, active workbook snapshot, and whether the
 * legacy daily_log is still populated.
 *
 * Collapsed by default — tap the small badge to expand.
 * Queries /api/provenance on every mount and on manual refresh.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { fetch as expoFetch } from "expo/fetch";
import { getApiUrl } from "@/lib/query-client";
import { getDeviceUserId } from "@/lib/user-identity";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ActiveWorkbook {
  id: number;
  filename: string;
  version_tag: string | null;
  uploaded_at: string;
  row_counts: Record<string, number>;
  is_active: boolean;
  selection_mode: "explicit" | "implicit" | "none";
}

interface Provenance {
  db_env: string;
  db_host: string;
  db_name: string;
  user_id: string;
  tables_read: string[];
  active_workbook: ActiveWorkbook | null;
  legacy_daily_log: boolean;
  generated_at: string;
}

// ─── Colours ──────────────────────────────────────────────────────────────────
const TEAL   = "#00D4AA";
const AMBER  = "#F59E0B";
const RED    = "#EF4444";
const MUTED  = "#475569";
const CARD   = "#111827";
const BORDER = "#1E2D40";
const TEXT   = "#F1F5F9";
const TEXTSEC = "#94A3B8";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function rowTotal(rc: Record<string, number>): number {
  return Object.values(rc).reduce((a, b) => a + b, 0);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ProvenanceBanner() {
  const [expanded, setExpanded]   = useState(false);
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const base = getApiUrl();
      const url  = new URL("/api/provenance", base).toString();
      const uid  = await getDeviceUserId();
      const res  = await expoFetch(url, {
        headers: uid ? { "X-User-Id": uid } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Provenance;
      setProvenance(data);
    } catch (e: any) {
      setError(e?.message ?? "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch every time the screen comes into focus
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Status dot colour ──────────────────────────────────────────────────────
  const wb = provenance?.active_workbook;
  const dotColor = !provenance
    ? MUTED
    : wb?.selection_mode === "explicit"
    ? TEAL
    : wb?.selection_mode === "implicit"
    ? AMBER
    : RED;

  const dotTitle = !provenance
    ? "Loading…"
    : wb?.selection_mode === "explicit"
    ? "Explicit active workbook"
    : wb?.selection_mode === "implicit"
    ? "No explicit activation — using most recent upload"
    : "No workbook — all screens reading legacy data";

  // ── Row counts string ──────────────────────────────────────────────────────
  const rowCountStr = wb
    ? Object.entries(wb.row_counts ?? {})
        .map(([s, n]) => `${s}:${n}`)
        .join(" · ")
    : "—";

  // ── Collapsed badge ────────────────────────────────────────────────────────
  if (!expanded) {
    return (
      <TouchableOpacity
        style={[styles.badge, { borderColor: dotColor }]}
        onPress={() => { setExpanded(true); if (!provenance) load(); }}
        activeOpacity={0.8}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={[styles.badgeText, { color: dotColor }]}>
          {loading ? "…" : wb ? `WB·${wb.id}` : "no-wb"}
        </Text>
      </TouchableOpacity>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <View style={styles.panel} pointerEvents="box-none">
      {/* Header */}
      <View style={styles.panelHeader}>
        <View style={styles.panelHeaderLeft}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <Text style={styles.panelTitle}>Source of Truth</Text>
        </View>
        <View style={styles.panelHeaderRight}>
          <TouchableOpacity onPress={load} style={styles.iconBtn} disabled={loading}>
            {loading
              ? <ActivityIndicator size="small" color={TEAL} />
              : <Ionicons name="refresh" size={16} color={TEAL} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setExpanded(false)} style={styles.iconBtn}>
            <Ionicons name="close" size={16} color={TEXTSEC} />
          </TouchableOpacity>
        </View>
      </View>

      {error && (
        <Text style={styles.errorText}>⚠ {error}</Text>
      )}

      {provenance && (
        <ScrollView
          style={styles.panelBody}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {/* DB block */}
          <Text style={styles.sectionLabel}>DATABASE</Text>
          <Row label="env"  value={provenance.db_env}  color={TEAL} />
          <Row label="host" value={provenance.db_host} />
          <Row label="db"   value={provenance.db_name} />
          <Row label="user_id" value={provenance.user_id} color={TEXTSEC} />

          {/* Legacy data warning */}
          {provenance.legacy_daily_log && (
            <View style={styles.warningRow}>
              <Ionicons name="warning" size={13} color={AMBER} />
              <Text style={styles.warningText}>
                legacy daily_log rows exist for this user
              </Text>
            </View>
          )}

          {/* Workbook block */}
          <Text style={[styles.sectionLabel, { marginTop: 12 }]}>ACTIVE WORKBOOK</Text>
          {wb ? (
            <>
              <Row label="id"       value={String(wb.id)}       color={TEAL} />
              <Row label="file"     value={wb.filename} />
              <Row label="tag"      value={wb.version_tag ?? "—"} />
              <Row label="mode"     value={wb.selection_mode}
                   color={wb.selection_mode === "explicit" ? TEAL : AMBER} />
              <Row label="uploaded" value={relTime(wb.uploaded_at)} />
              <Row label="rows"     value={rowTotal(wb.row_counts ?? {})} />
              <Text style={styles.rowCountStr}>{rowCountStr}</Text>
            </>
          ) : (
            <Text style={[styles.errorText, { color: RED }]}>
              No workbook uploaded for this user
            </Text>
          )}

          {/* Dotted title for dot meaning */}
          <Text style={[styles.dotTitle, { color: dotColor }]}>{dotTitle}</Text>

          <Text style={styles.timestamp}>
            checked {relTime(provenance.generated_at)}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Small Row ────────────────────────────────────────────────────────────────
function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, color ? { color } : {}]} selectable>
        {String(value)}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Collapsed badge — bottom-right corner
  badge: {
    position: "absolute",
    bottom: Platform.OS === "web" ? 100 : 80,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: 6,
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Rubik_600SemiBold",
    letterSpacing: 0.3,
  },

  // Expanded panel
  panel: {
    position: "absolute",
    bottom: Platform.OS === "web" ? 100 : 80,
    right: 12,
    width: 300,
    maxHeight: 420,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 12,
    overflow: "hidden",
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  panelHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  panelHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  panelTitle: {
    fontSize: 13,
    fontFamily: "Rubik_700Bold",
    color: TEXT,
    letterSpacing: 0.3,
  },
  iconBtn: {
    padding: 4,
  },
  panelBody: {
    padding: 14,
  },
  sectionLabel: {
    fontSize: 9,
    fontFamily: "Rubik_700Bold",
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  rowLabel: {
    fontSize: 11,
    fontFamily: "Rubik_500Medium",
    color: MUTED,
    width: 60,
  },
  rowValue: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: TEXT,
    flex: 1,
    textAlign: "right",
    flexWrap: "wrap",
  },
  rowCountStr: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: MUTED,
    marginTop: 4,
    lineHeight: 14,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: 6,
    padding: 6,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
  },
  warningText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: AMBER,
    flex: 1,
  },
  dotTitle: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    marginTop: 12,
    lineHeight: 15,
  },
  timestamp: {
    fontSize: 10,
    fontFamily: "Rubik_400Regular",
    color: MUTED,
    marginTop: 8,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 11,
    fontFamily: "Rubik_400Regular",
    color: AMBER,
    marginVertical: 4,
  },
});

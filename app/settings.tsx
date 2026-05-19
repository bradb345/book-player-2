import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  ScrollView,
  Switch,
  Modal,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { colors } from "@/constants/theme";
import { sharedStyles } from "@/constants/styles";
import { useSettings } from "@/services/settingsContext";

const SKIP_OPTIONS = [10, 15, 30, 45, 60];
const REWIND_OPTIONS = [0, 2, 5, 10, 15, 30];
const SPEED_OPTIONS = [0.8, 1.0, 1.2, 1.5, 2.0];
const SLEEP_DURATION_OPTIONS = [15, 30, 45, 60, 90];

const REPO_URL = "https://github.com/bradb345/book-player-2";
const NEW_ISSUE_URL = `${REPO_URL}/issues/new`;

function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

interface ChipsProps<T> {
  options: T[];
  value: T;
  onSelect: (value: T) => void;
  format: (value: T) => string;
}

function Chips<T>({ options, value, onSelect, format }: ChipsProps<T>) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={String(option)}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onSelect(option)}
          >
            <Text
              style={[styles.chipText, selected && styles.chipTextSelected]}
            >
              {format(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface TimePickerModalProps {
  visible: boolean;
  title: string;
  initialMinutes: number;
  onConfirm: (minutes: number) => void;
  onClose: () => void;
}

function TimePickerModal({
  visible,
  title,
  initialMinutes,
  onConfirm,
  onClose,
}: TimePickerModalProps) {
  const [hour, setHour] = useState(Math.floor(initialMinutes / 60) % 24);
  const [minute, setMinute] = useState(initialMinutes % 60);

  // Re-seed the steppers whenever the modal is (re)opened.
  const [seed, setSeed] = useState(initialMinutes);
  if (visible && seed !== initialMinutes) {
    setSeed(initialMinutes);
    setHour(Math.floor(initialMinutes / 60) % 24);
    setMinute(initialMinutes % 60);
  }

  const wrap = (v: number, max: number) => ((v % max) + max) % max;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.timeModal} onPress={() => {}}>
          <Text style={styles.timeModalTitle}>{title}</Text>
          <View style={styles.stepperRow}>
            <View style={styles.stepper}>
              <Pressable
                hitSlop={8}
                onPress={() => setHour((h) => wrap(h + 1, 24))}
              >
                <Ionicons name="chevron-up" size={28} color={colors.white} />
              </Pressable>
              <Text style={styles.stepperValue}>
                {hour.toString().padStart(2, "0")}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setHour((h) => wrap(h - 1, 24))}
              >
                <Ionicons name="chevron-down" size={28} color={colors.white} />
              </Pressable>
            </View>
            <Text style={styles.stepperColon}>:</Text>
            <View style={styles.stepper}>
              <Pressable
                hitSlop={8}
                onPress={() => setMinute((m) => wrap(m + 5, 60))}
              >
                <Ionicons name="chevron-up" size={28} color={colors.white} />
              </Pressable>
              <Text style={styles.stepperValue}>
                {minute.toString().padStart(2, "0")}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => setMinute((m) => wrap(m - 5, 60))}
              >
                <Ionicons name="chevron-down" size={28} color={colors.white} />
              </Pressable>
            </View>
          </View>
          <View style={styles.timeModalButtons}>
            <Pressable style={styles.modalButton} onPress={onClose}>
              <Text style={styles.modalButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.modalButtonPrimary]}
              onPress={() => onConfirm(hour * 60 + minute)}
            >
              <Text style={styles.modalButtonText}>Set</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings, updateSetting } = useSettings();
  const [picker, setPicker] = useState<"start" | "end" | null>(null);

  const version = Constants.expoConfig?.version ?? "1.0.0";

  const openLink = (url: string) => {
    Linking.openURL(url).catch((e) =>
      console.warn("Error opening link:", e)
    );
  };

  return (
    <View style={sharedStyles.container}>
      <StatusBar barStyle="light-content" />

      <View style={[sharedStyles.header, { paddingTop: insets.top + 5 }]}>
        <Pressable
          style={sharedStyles.backButton}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={28} color={colors.white} />
        </Pressable>
        <Text style={sharedStyles.headerTitle}>Settings</Text>
        <View style={sharedStyles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Playback */}
        <Text style={styles.sectionTitle}>Playback</Text>
        <View style={styles.card}>
          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Skip interval</Text>
            <Text style={styles.settingHint}>
              Forward / back buttons and lock-screen jumps
            </Text>
            <Chips
              options={SKIP_OPTIONS}
              value={settings.skipSeconds}
              onSelect={(v) => updateSetting("skipSeconds", v)}
              format={(v) => `${v}s`}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Auto-rewind on resume</Text>
            <Text style={styles.settingHint}>
              Rewind this much when resuming after a pause
            </Text>
            <Chips
              options={REWIND_OPTIONS}
              value={settings.autoRewindSeconds}
              onSelect={(v) => updateSetting("autoRewindSeconds", v)}
              format={(v) => (v === 0 ? "Off" : `${v}s`)}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingBlock}>
            <Text style={styles.settingLabel}>Default speed</Text>
            <Text style={styles.settingHint}>
              Applied when a book is opened
            </Text>
            <Chips
              options={SPEED_OPTIONS}
              value={settings.defaultPlaybackSpeed}
              onSelect={(v) => updateSetting("defaultPlaybackSpeed", v)}
              format={(v) => `${v.toFixed(1)}x`}
            />
          </View>
        </View>

        {/* Sleep Timer */}
        <Text style={styles.sectionTitle}>Sleep Timer</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingRowText}>
              <Text style={styles.settingLabel}>Auto sleep timer</Text>
              <Text style={styles.settingHint}>
                Pause automatically during a nightly window
              </Text>
            </View>
            <Switch
              value={settings.autoSleepEnabled}
              onValueChange={(v) => updateSetting("autoSleepEnabled", v)}
              trackColor={{ false: colors.darkGrey, true: colors.red }}
              thumbColor={colors.white}
            />
          </View>

          {settings.autoSleepEnabled && (
            <>
              <View style={styles.divider} />
              <Pressable
                style={styles.settingRow}
                onPress={() => setPicker("start")}
              >
                <Text style={styles.settingLabel}>Active from</Text>
                <Text style={styles.settingValue}>
                  {formatClock(settings.autoSleepStartMin)}
                </Text>
              </Pressable>

              <View style={styles.divider} />
              <Pressable
                style={styles.settingRow}
                onPress={() => setPicker("end")}
              >
                <Text style={styles.settingLabel}>Active until</Text>
                <Text style={styles.settingValue}>
                  {formatClock(settings.autoSleepEndMin)}
                </Text>
              </Pressable>

              <View style={styles.divider} />
              <View style={styles.settingBlock}>
                <Text style={styles.settingLabel}>Pause after</Text>
                <Chips
                  options={SLEEP_DURATION_OPTIONS}
                  value={settings.autoSleepDurationMin}
                  onSelect={(v) => updateSetting("autoSleepDurationMin", v)}
                  format={(v) => `${v} min`}
                />
              </View>
            </>
          )}
        </View>

        {/* Help */}
        <Text style={styles.sectionTitle}>Help</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.linkRow}
            onPress={() => openLink(NEW_ISSUE_URL)}
          >
            <Ionicons name="bug-outline" size={22} color={colors.white} />
            <Text style={styles.linkText}>Report a bug</Text>
            <Ionicons name="open-outline" size={18} color={colors.lightGrey} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.linkRow}
            onPress={() => openLink(NEW_ISSUE_URL)}
          >
            <Ionicons name="bulb-outline" size={22} color={colors.white} />
            <Text style={styles.linkText}>Suggest an idea</Text>
            <Ionicons name="open-outline" size={18} color={colors.lightGrey} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.linkRow} onPress={() => openLink(REPO_URL)}>
            <Ionicons name="logo-github" size={22} color={colors.white} />
            <Text style={styles.linkText}>View source code</Text>
            <Ionicons name="open-outline" size={18} color={colors.lightGrey} />
          </Pressable>
        </View>

        {/* About */}
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              {Constants.expoConfig?.name ?? "Audiobooks"}
            </Text>
            <Text style={styles.settingValue}>v{version}</Text>
          </View>
        </View>
      </ScrollView>

      <TimePickerModal
        visible={picker !== null}
        title={picker === "start" ? "Active from" : "Active until"}
        initialMinutes={
          picker === "end"
            ? settings.autoSleepEndMin
            : settings.autoSleepStartMin
        }
        onClose={() => setPicker(null)}
        onConfirm={(minutes) => {
          if (picker === "start") {
            updateSetting("autoSleepStartMin", minutes);
          } else if (picker === "end") {
            updateSetting("autoSleepEndMin", minutes);
          }
          setPicker(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.lightGrey,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  card: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
  },
  settingBlock: {
    paddingVertical: 16,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  settingRowText: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    color: colors.white,
  },
  settingHint: {
    fontSize: 13,
    color: colors.lightGrey,
    marginTop: 2,
    marginBottom: 12,
  },
  settingValue: {
    fontSize: 16,
    color: colors.red,
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.darkGrey,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.darkGrey,
  },
  chipSelected: {
    backgroundColor: colors.red,
  },
  chipText: {
    fontSize: 14,
    color: colors.lightGrey,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: colors.white,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 14,
  },
  linkText: {
    flex: 1,
    fontSize: 16,
    color: colors.white,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  timeModal: {
    backgroundColor: colors.mediumGrey,
    borderRadius: 16,
    padding: 24,
    width: "80%",
    maxWidth: 360,
  },
  timeModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.white,
    textAlign: "center",
    marginBottom: 20,
  },
  stepperRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  stepper: {
    alignItems: "center",
    gap: 8,
  },
  stepperValue: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.white,
    minWidth: 56,
    textAlign: "center",
  },
  stepperColon: {
    fontSize: 34,
    fontWeight: "700",
    color: colors.white,
  },
  timeModalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.darkGrey,
  },
  modalButtonPrimary: {
    backgroundColor: colors.red,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.white,
  },
});

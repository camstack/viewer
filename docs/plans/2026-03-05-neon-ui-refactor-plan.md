# Neon UI Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the entire CamStack app to a dark-only Neon design system, redesign settings UX with contextual bottom sheets, and unify events+videoclips into a single view.

**Architecture:** Create a foundational design token system (`src/theme/neon/`) with shared primitive components (`src/components/neon/`), then progressively migrate all screens from the current light/dark theme to dark-only Neon styling. Settings pages are restructured from tab-based long forms to a card hub with collapsible sections. Events and Videoclips tabs merge into one unified view with client-side clip linking.

**Tech Stack:** React Native 0.81.5, Expo ~54, TypeScript 5.9, Zustand, TanStack React Query, Ionicons, expo-image, react-native-video

**Verification:** No unit test framework exists. Use `npm run ts-check` after each task to verify TypeScript correctness. Visual verification via `npm run start:dev` or `npm run web`.

---

## Phase 1: Foundation — Design Tokens & Primitives

### Task 1: Create Neon Design Tokens

**Files:**
- Create: `src/theme/neon/colors.ts`
- Create: `src/theme/neon/typography.ts`
- Create: `src/theme/neon/spacing.ts`
- Create: `src/theme/neon/index.ts`

**Step 1: Create the colors token file**

```typescript
// src/theme/neon/colors.ts

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const withAlpha = (hex: string, alpha: number): string => hexToRgba(hex, alpha);

export const neon = {
  // Backgrounds (darkest → lightest)
  bg: "#000000",
  bgElevated: "#0A0A0A",
  bgSurface: "#0D0D0D",
  bgInput: "#111111",
  bgOverlay: "rgba(255,255,255,0.04)",

  // Borders
  borderSubtle: "#1a1a1a",
  border: "#222222",
  borderStrong: "#333333",
  borderInput: "#48484A",

  // Text
  textPrimary: "#FFFFFF",
  textSecondary: "#888888",
  textTertiary: "#666666",
  textDisabled: "#555555",
  textMuted: "#444444",

  // System accents
  accent: "#007AFF",
  accentBg: "rgba(0,122,255,0.15)",
  accentActive: "rgba(0,122,255,0.8)",
  danger: "#FF3B30",
  dangerBg: "rgba(255,59,48,0.15)",
  success: "#34C759",

  // Event neon colors
  event: {
    person: "#34C759",
    face: "#30D158",
    car: "#FF9500",
    animal: "#AF52DE",
    audio: "#FFCC00",
    doorbell: "#FF3B30",
    motion: "#007AFF",
    package: "#5856D6",
  } as Record<string, string>,
} as const;
```

**Step 2: Create the typography token file**

```typescript
// src/theme/neon/typography.ts

export const type = {
  size: {
    xs: 9,
    sm: 10,
    base: 11,
    md: 12,
    lg: 13,
    xl: 14,
    "2xl": 16,
    "3xl": 18,
  },
  weight: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
  tabularNums: { fontVariant: ["tabular-nums" as const] },
} as const;
```

**Step 3: Create the spacing token file**

```typescript
// src/theme/neon/spacing.ts

export const space = {
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "8": 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
} as const;
```

**Step 4: Create the barrel export**

```typescript
// src/theme/neon/index.ts
export { neon, withAlpha } from "./colors";
export { type } from "./typography";
export { space, radius } from "./spacing";
```

**Step 5: Verify**

Run: `npm run ts-check`
Expected: PASS (new files only, no imports yet)

**Step 6: Commit**

```bash
git add src/theme/neon/
git commit -m "feat: add Neon design token system (colors, typography, spacing)"
```

---

### Task 2: Create NeonCard Component

**Files:**
- Create: `src/components/neon/NeonCard.tsx`

**Step 1: Implement NeonCard**

```typescript
// src/components/neon/NeonCard.tsx
import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { neon, withAlpha, radius } from "@/theme/neon";

interface NeonCardProps extends ViewProps {
  variant?: "flat" | "elevated" | "outlined";
  neonColor?: string;
  selected?: boolean;
}

export function NeonCard({
  variant = "flat",
  neonColor,
  selected = false,
  style,
  children,
  ...props
}: NeonCardProps) {
  const variantStyle =
    variant === "elevated"
      ? styles.elevated
      : variant === "outlined"
        ? styles.outlined
        : styles.flat;

  const selectedStyle = selected && neonColor
    ? { borderWidth: 2, borderColor: neonColor }
    : undefined;

  return (
    <View style={[styles.base, variantStyle, selectedStyle, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  flat: {
    backgroundColor: neon.bgOverlay,
  },
  elevated: {
    backgroundColor: neon.bgElevated,
  },
  outlined: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: neon.border,
  },
});
```

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/neon/NeonCard.tsx
git commit -m "feat: add NeonCard primitive component"
```

---

### Task 3: Create NeonButton Component

**Files:**
- Create: `src/components/neon/NeonButton.tsx`

**Step 1: Implement NeonButton**

```typescript
// src/components/neon/NeonButton.tsx
import React from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  type TouchableOpacityProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { neon, withAlpha, radius, type, space } from "@/theme/neon";

type ButtonVariant = "fab" | "icon" | "chip" | "action" | "primary" | "danger";

interface NeonButtonProps extends Omit<TouchableOpacityProps, "children"> {
  variant: ButtonVariant;
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  neonColor?: string;
  active?: boolean;
}

export function NeonButton({
  variant,
  label,
  icon,
  iconSize,
  neonColor,
  active = false,
  disabled = false,
  style,
  ...props
}: NeonButtonProps) {
  const resolvedColor = neonColor ?? neon.accent;

  const variantStyles: Record<ButtonVariant, object> = {
    fab: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(20,20,20,0.85)",
      borderWidth: 1,
      borderColor: active ? neon.accent : neon.borderStrong,
      ...(active && { backgroundColor: neon.accentBg }),
    },
    icon: {
      width: 30,
      height: 30,
      borderRadius: radius.md,
      backgroundColor: active ? neon.accentActive : "transparent",
    },
    chip: {
      paddingHorizontal: space[2],
      paddingVertical: space[1],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: active ? resolvedColor : neon.textMuted,
      backgroundColor: active ? withAlpha(resolvedColor, 0.2) : "transparent",
      flexDirection: "row" as const,
      gap: space[1],
    },
    action: {
      paddingHorizontal: space[3],
      paddingVertical: space["1.5"],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: withAlpha(resolvedColor, 0.375),
      flexDirection: "row" as const,
      gap: space[1],
    },
    primary: {
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      borderRadius: radius.md,
      backgroundColor: neon.accent,
    },
    danger: {
      paddingHorizontal: space[4],
      paddingVertical: space[3],
      borderRadius: radius.md,
      backgroundColor: neon.danger,
    },
  };

  const iconColor =
    variant === "chip"
      ? active
        ? neon.textPrimary
        : neon.textTertiary
      : variant === "primary" || variant === "danger"
        ? neon.textPrimary
        : active
          ? neon.textPrimary
          : neon.textSecondary;

  const textColor = iconColor;

  const defaultIconSize =
    variant === "fab" ? 18 : variant === "chip" ? 14 : 16;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled}
      style={[
        styles.base,
        variantStyles[variant],
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={iconSize ?? defaultIconSize}
          color={iconColor}
        />
      )}
      {label && (
        <Text
          style={[
            styles.label,
            variant === "chip" && styles.chipLabel,
            variant === "primary" && styles.primaryLabel,
            variant === "danger" && styles.primaryLabel,
            { color: textColor },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.35,
  },
  label: {
    fontSize: type.size.md,
    fontWeight: type.weight.medium,
  },
  chipLabel: {
    fontSize: type.size.base,
    fontWeight: type.weight.medium,
  },
  primaryLabel: {
    fontSize: type.size.xl,
    fontWeight: type.weight.semibold,
    textAlign: "center",
  },
});
```

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/neon/NeonButton.tsx
git commit -m "feat: add NeonButton primitive component"
```

---

### Task 4: Create NeonInput, NeonSwitch, NeonChip Components

**Files:**
- Create: `src/components/neon/NeonInput.tsx`
- Create: `src/components/neon/NeonSwitch.tsx`
- Create: `src/components/neon/NeonChip.tsx`

**Step 1: Implement NeonInput**

```typescript
// src/components/neon/NeonInput.tsx
import React from "react";
import { StyleSheet, View, Text, TextInput, type TextInputProps } from "react-native";
import { neon, radius, type, space } from "@/theme/neon";

interface NeonInputProps extends TextInputProps {
  label?: string;
  colorPreview?: string; // shows a color swatch next to input
}

export function NeonInput({ label, colorPreview, style, ...props }: NeonInputProps) {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.row}>
        {colorPreview && (
          <View style={[styles.swatch, { backgroundColor: colorPreview }]} />
        )}
        <TextInput
          placeholderTextColor={neon.textDisabled}
          style={[styles.input, colorPreview && styles.inputWithSwatch, style]}
          {...props}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[1] },
  label: {
    fontSize: type.size.md,
    fontWeight: type.weight.medium,
    color: neon.textSecondary,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: neon.borderStrong,
  },
  input: {
    flex: 1,
    backgroundColor: neon.bgInput,
    borderWidth: 1,
    borderColor: neon.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: type.size.xl,
    color: neon.textPrimary,
  },
  inputWithSwatch: { flex: 1 },
});
```

**Step 2: Implement NeonSwitch**

```typescript
// src/components/neon/NeonSwitch.tsx
import React from "react";
import { StyleSheet, View, Text, Switch } from "react-native";
import { neon, type, space } from "@/theme/neon";

interface NeonSwitchProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export function NeonSwitch({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: NeonSwitchProps) {
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <View style={styles.textCol}>
          <Text style={styles.label}>{label}</Text>
          {description && <Text style={styles.description}>{description}</Text>}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: neon.borderStrong, true: neon.accent }}
          thumbColor={neon.textPrimary}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: space[2] },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textCol: { flex: 1, marginRight: space[3] },
  label: {
    fontSize: type.size.xl,
    fontWeight: type.weight.medium,
    color: neon.textPrimary,
  },
  description: {
    fontSize: type.size.md,
    color: neon.textSecondary,
    marginTop: space["0.5"],
  },
});
```

**Step 3: Implement NeonChip**

```typescript
// src/components/neon/NeonChip.tsx
import React from "react";
import { StyleSheet, TouchableOpacity, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { neon, withAlpha, radius, type, space } from "@/theme/neon";

interface NeonChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  neonColor: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function NeonChip({
  label,
  icon,
  neonColor,
  selected,
  onPress,
  disabled,
}: NeonChipProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        {
          borderColor: selected ? neonColor : neon.textMuted,
          backgroundColor: selected ? withAlpha(neonColor, 0.2) : "transparent",
        },
        disabled && styles.disabled,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? neon.textPrimary : neon.textTertiary}
        />
      )}
      <Text
        style={[
          styles.label,
          { color: selected ? neon.textPrimary : neon.textTertiary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  label: {
    fontSize: type.size.base,
    fontWeight: type.weight.medium,
  },
  disabled: { opacity: 0.35 },
});
```

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add src/components/neon/NeonInput.tsx src/components/neon/NeonSwitch.tsx src/components/neon/NeonChip.tsx
git commit -m "feat: add NeonInput, NeonSwitch, NeonChip primitive components"
```

---

### Task 5: Create NeonSection Component

**Files:**
- Create: `src/components/neon/NeonSection.tsx`

**Step 1: Implement NeonSection**

Collapsible accordion section with animated chevron. This is a key component for the settings redesign.

```typescript
// src/components/neon/NeonSection.tsx
import React, { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { neon, radius, type, space } from "@/theme/neon";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface NeonSectionProps {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function NeonSection({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
  icon,
}: NeonSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const rotation = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current;

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = !isOpen;
    setIsOpen(next);
    Animated.timing(rotation, {
      toValue: next ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isOpen, rotation]);

  const chevronRotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={collapsible ? toggle : undefined}
        activeOpacity={collapsible ? 0.7 : 1}
        disabled={!collapsible}
      >
        <View style={styles.titleRow}>
          {icon && (
            <Ionicons name={icon} size={14} color={neon.textSecondary} />
          )}
          <Text style={styles.title}>{title.toUpperCase()}</Text>
        </View>
        {collapsible && (
          <Animated.View style={{ transform: [{ rotate: chevronRotate }] }}>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={neon.textSecondary}
            />
          </Animated.View>
        )}
      </TouchableOpacity>
      {(!collapsible || isOpen) && (
        <View style={styles.content}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: neon.bgElevated,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: space[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  title: {
    fontSize: type.size.base,
    fontWeight: type.weight.semibold,
    color: neon.textSecondary,
    letterSpacing: 1,
  },
  content: {
    paddingHorizontal: space[4],
    paddingBottom: space[4],
    borderTopWidth: 1,
    borderTopColor: neon.borderSubtle,
  },
});
```

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/neon/NeonSection.tsx
git commit -m "feat: add NeonSection collapsible accordion component"
```

---

### Task 6: Create NeonModal Component

**Files:**
- Create: `src/components/neon/NeonModal.tsx`

**Step 1: Implement NeonModal**

Bottom-sheet style modal with handle bar, backdrop, snap-to-height behavior.

```typescript
// src/components/neon/NeonModal.tsx
import React, { useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  Animated,
  Dimensions,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { neon, radius, type, space } from "@/theme/neon";

interface NeonModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Height as fraction of screen: 0.5 = 50%, 0.85 = 85%. Default 0.85 */
  heightFraction?: number;
  children: React.ReactNode;
  keyboardAvoiding?: boolean;
}

export function NeonModal({
  visible,
  onClose,
  title,
  heightFraction = 0.85,
  children,
  keyboardAvoiding = false,
}: NeonModalProps) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(0)).current;
  const screenHeight = Dimensions.get("window").height;
  const maxHeight = screenHeight * heightFraction;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(0);
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [maxHeight, 0],
  });

  const Wrapper = keyboardAvoiding ? KeyboardAvoidingView : View;
  const wrapperProps = keyboardAvoiding
    ? { behavior: Platform.OS === "ios" ? ("padding" as const) : undefined, style: { flex: 1 } }
    : { style: { flex: 1 } };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Wrapper {...wrapperProps}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight,
              paddingBottom: insets.bottom || space[4],
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>
          {title && (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={20} color={neon.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </Wrapper>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: neon.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  handleRow: {
    alignItems: "center",
    paddingTop: space[2],
    paddingBottom: space[1],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: neon.borderStrong,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: neon.borderSubtle,
  },
  title: {
    fontSize: type.size["2xl"],
    fontWeight: type.weight.semibold,
    color: neon.textPrimary,
  },
  body: { flex: 1 },
  bodyContent: { padding: space[4] },
});
```

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/neon/NeonModal.tsx
git commit -m "feat: add NeonModal bottom sheet component"
```

---

### Task 7: Create NeonSelect, NeonTabBar, and Barrel Export

**Files:**
- Create: `src/components/neon/NeonSelect.tsx`
- Create: `src/components/neon/NeonTabBar.tsx`
- Create: `src/components/neon/index.ts`

**Step 1: Implement NeonSelect**

```typescript
// src/components/neon/NeonSelect.tsx
import React from "react";
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { neon, radius, type, space } from "@/theme/neon";

interface SelectOption {
  value: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface NeonSelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export function NeonSelect({ label, options, value, onChange }: NeonSelectProps) {
  // Inline chip row for <=6 options
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.optionsRow}
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.option, isActive && styles.optionActive]}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.7}
            >
              {opt.icon && (
                <Ionicons
                  name={opt.icon}
                  size={14}
                  color={isActive ? neon.textPrimary : neon.textSecondary}
                />
              )}
              <Text
                style={[styles.optionText, isActive && styles.optionTextActive]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[1] },
  label: {
    fontSize: type.size.md,
    fontWeight: type.weight.medium,
    color: neon.textSecondary,
  },
  optionsRow: {
    flexDirection: "row",
    gap: space["1.5"],
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    backgroundColor: neon.bgInput,
    borderWidth: 1,
    borderColor: neon.borderStrong,
  },
  optionActive: {
    backgroundColor: neon.accentActive,
    borderColor: neon.accent,
  },
  optionText: {
    fontSize: type.size.md,
    fontWeight: type.weight.medium,
    color: neon.textSecondary,
  },
  optionTextActive: {
    color: neon.textPrimary,
  },
});
```

**Step 2: Implement NeonTabBar**

```typescript
// src/components/neon/NeonTabBar.tsx
import React from "react";
import { StyleSheet, ScrollView, TouchableOpacity, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { neon, radius, type, space } from "@/theme/neon";

interface Tab {
  key: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface NeonTabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function NeonTabBar({ tabs, activeTab, onTabChange }: NeonTabBarProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => onTabChange(tab.key)}
              activeOpacity={0.7}
            >
              {tab.icon && (
                <Ionicons
                  name={tab.icon}
                  size={14}
                  color={isActive ? neon.textPrimary : neon.textSecondary}
                />
              )}
              <Text
                style={[styles.tabText, isActive && styles.tabTextActive]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: neon.borderSubtle,
  },
  scrollContent: {
    flexDirection: "row",
    paddingHorizontal: space[4],
    gap: space[1],
    paddingVertical: space[2],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    paddingVertical: space["1.5"],
    borderRadius: radius.full,
  },
  tabActive: {
    backgroundColor: neon.accentActive,
  },
  tabText: {
    fontSize: type.size.md,
    fontWeight: type.weight.medium,
    color: neon.textSecondary,
  },
  tabTextActive: {
    color: neon.textPrimary,
    fontWeight: type.weight.semibold,
  },
});
```

**Step 3: Create barrel export**

```typescript
// src/components/neon/index.ts
export { NeonCard } from "./NeonCard";
export { NeonButton } from "./NeonButton";
export { NeonInput } from "./NeonInput";
export { NeonSwitch } from "./NeonSwitch";
export { NeonChip } from "./NeonChip";
export { NeonSection } from "./NeonSection";
export { NeonModal } from "./NeonModal";
export { NeonSelect } from "./NeonSelect";
export { NeonTabBar } from "./NeonTabBar";
```

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add src/components/neon/
git commit -m "feat: add NeonSelect, NeonTabBar components and barrel export"
```

---

## Phase 2: Settings Redesign

### Task 8: Force Dark Mode in App Config

**Files:**
- Modify: `app.config.ts` (line 21: `userInterfaceStyle`)

**Step 1: Change userInterfaceStyle to "dark"**

In `app.config.ts`, change `userInterfaceStyle: "automatic"` to `userInterfaceStyle: "dark"`.

Also update the splash screen to always use dark background.

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add app.config.ts
git commit -m "feat: force dark mode in app configuration"
```

---

### Task 9: Rebuild Settings Hub (index page)

**Files:**
- Modify: `app/(tabs)/settings/index.tsx` (currently 5 LOC, just a redirect)
- Modify: `app/(tabs)/settings/_layout.tsx` (currently 29 LOC)
- Delete: `src/components/SettingsTabs.tsx` (378 LOC, replaced by hub)

**Step 1: Rewrite settings index as a card grid hub**

Replace the redirect with a full hub page. The hub shows 4 NeonCards: Appearance, Integrations, Cameras, Advanced. Each card navigates to its sub-page.

Read the current `_layout.tsx` to understand routing, then modify it to use a simple Stack layout instead of the SettingsTabs component.

The sub-routes will be:
- `appearance` (renamed from `general`)
- `integrations` (keep)
- `cameras` (renamed from `stream`, merges camera list)
- `advanced` (new, merges logs + data management)

**Step 2: Update _layout.tsx**

Remove `SettingsTabs` import and rendering. Use a simple `<Stack>` or `<Slot>` layout with dark background.

**Step 3: Verify**

Run: `npm run ts-check`

**Step 4: Commit**

```bash
git add app/(tabs)/settings/
git commit -m "feat: rebuild settings as card hub with neon styling"
```

---

### Task 10: Rebuild Appearance Settings Page

**Files:**
- Create: `app/(tabs)/settings/appearance.tsx` (replaces `general.tsx`)
- Modify or delete: `app/(tabs)/settings/general.tsx` (749 LOC)

**Step 1: Create appearance.tsx**

Build the page using NeonSection collapsible for each group:
- Language (NeonSelect: System/IT/EN)
- Timeline Mode (NeonSelect: Classic/Theater)
- Highlight Motion (NeonSwitch toggle + NeonInput color + thickness selector)
- Highlight Audio (same)
- Highlight Detection (same)

Remove theme selector (no longer needed — always dark).

Import all values from `useGeneralSettings()` hook. Each control updates the setting immediately (same as current behavior).

Use `NeonSection collapsible defaultOpen={false}` for highlight sections (they're less frequently changed).

**Step 2: Remove or redirect general.tsx**

Either delete `general.tsx` and update routing, or make it redirect to `appearance`.

**Step 3: Verify**

Run: `npm run ts-check`

**Step 4: Commit**

```bash
git add app/(tabs)/settings/
git commit -m "feat: rebuild appearance settings with NeonSection collapsible groups"
```

---

### Task 11: Rebuild Cameras Settings Page

**Files:**
- Create: `app/(tabs)/settings/cameras.tsx` (replaces `stream.tsx`, merges camera list)
- Modify or delete: `app/(tabs)/settings/stream.tsx` (735 LOC)

**Step 1: Build cameras.tsx**

Merge the stream settings and camera list into one page with NeonSections:

- Section "Grid Layout": columns selector (NeonSelect), show name toggle (NeonSwitch), show state toggle (NeonSwitch)
- Section "Stream Quality": quality for single view (NeonSelect), quality for grid (NeonSelect)
- Section "Stream Behavior": play on open (NeonSwitch), audio on open (NeonSwitch), watchdog (NeonSwitch)
- Section "Cameras": Camera list with NeonCards. Each card shows camera name + source type badge + gear icon. Tap gear → navigates to `cameras/[id]`. Drag handle for reorder.

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add app/(tabs)/settings/
git commit -m "feat: rebuild cameras settings page with neon styling"
```

---

### Task 12: Rebuild Integrations Settings Page

**Files:**
- Modify: `app/(tabs)/settings/integrations.tsx` (142 LOC)
- Modify: `src/components/IntegrationInstanceCard.tsx` (782 LOC)
- Modify: `src/components/AddIntegrationModal.tsx`

**Step 1: Restyle integrations.tsx**

Replace the page background and styling with neon tokens. Replace the "Add Integration" button with a `NeonButton variant="action"`.

**Step 2: Restyle IntegrationInstanceCard**

Replace all `useThemeColors()` usage with neon tokens. Replace inline styles with neon components:
- Card container → `NeonCard variant="elevated"`
- Text inputs → `NeonInput`
- Toggle visibility → `NeonSection collapsible`
- Test/Save buttons → `NeonButton variant="primary"` / `NeonButton variant="action"`

**Step 3: Restyle AddIntegrationModal**

Replace with `NeonModal` wrapping integration type selection using `NeonCard` for each type.

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add app/(tabs)/settings/integrations.tsx src/components/IntegrationInstanceCard.tsx src/components/AddIntegrationModal.tsx
git commit -m "feat: restyle integrations settings with neon components"
```

---

### Task 13: Create Advanced Settings Page

**Files:**
- Create: `app/(tabs)/settings/advanced.tsx` (merges logs.tsx + data management from general.tsx)
- Delete: `app/(tabs)/settings/logs.tsx` (240 LOC)

**Step 1: Build advanced.tsx**

Sections:
- Section "Data" (collapsible, defaultOpen): Export/Import buttons (NeonButton action)
- Section "Cache": Clear cache button (NeonButton danger) with confirmation
- Section "Log" (collapsible, defaultOpen): Restyle the FlatList log viewer with neon tokens. Keep functionality from current logs.tsx.
- Section "Info": Version info display with neon text styling

**Step 2: Delete logs.tsx**

Remove the old file, update any routing references.

**Step 3: Verify**

Run: `npm run ts-check`

**Step 4: Commit**

```bash
git add app/(tabs)/settings/
git commit -m "feat: create advanced settings page merging logs and data management"
```

---

### Task 14: Rebuild CameraSettingsForm with NeonTabBar

**Files:**
- Modify: `src/components/CameraSettingsForm.tsx` (699 LOC → full rewrite)
- Modify: `src/components/NvrCameraSettings.tsx` (510 LOC → restyle)
- Modify: `app/(tabs)/settings/cameras/[id].tsx` (53 LOC)

**Step 1: Rewrite CameraSettingsForm**

Replace the monolithic scrollable form with a tabbed layout:

```typescript
const CAMERA_TABS = [
  { key: "highlight", label: "Highlight", icon: "color-palette" },
  { key: "timeline", label: "Timeline", icon: "time" },
  { key: "status", label: "Status", icon: "information-circle" },
  { key: "sensors", label: "Sensors", icon: "hardware-chip" },
  { key: "devices", label: "Devices", icon: "link" },
  { key: "source", label: "Source", icon: "settings" }, // Separate NVR only
];
```

- Top: `NeonTabBar` with the tabs above
- Content area: Renders only the active tab's content
- Remove `variant` prop — always use neon styling

Each tab content uses NeonSection, NeonSwitch, NeonInput, NeonChip, NeonSelect.

**Highlight tab:**
- NeonSection "Motion": NeonSwitch + NeonInput color + thickness selector
- NeonSection "Audio": Mode selector (NeonSelect off/sensor/level) + conditional presets (NeonSelect) or custom counters
- NeonSection "Detection": NeonSwitch + class toggles (NeonChip per class) + hold seconds

**Timeline tab:**
- NeonSection "Data Source": NeonSelect (videoclips/AdvancedNotifier/NVR/Separate NVR/Auto)
- NeonSection "Event Severity": NeonSelect (all/important/critical/custom) + conditional NeonChip multi-select for classes

**Status tab:**
- NeonSection "Position": 3x3 visual position selector
- NeonSection "Indicators": NeonChip toggles for each indicator type

**Sensors tab:**
- Same pattern as Status

**Devices tab:**
- Associated devices button → opens CameraAssociatedDevicesModal

**Source tab (Separate NVR only):**
- NvrCameraSettings restyled with neon components

**Step 2: Update cameras/[id].tsx**

Remove `variant="page"` prop. The form now always renders neon-styled.

**Step 3: Restyle NvrCameraSettings**

Replace all `useThemeColors()` with neon tokens. Replace inline styled controls with NeonSection, NeonSelect, NeonButton.

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add src/components/CameraSettingsForm.tsx src/components/NvrCameraSettings.tsx app/(tabs)/settings/cameras/
git commit -m "feat: rebuild CameraSettingsForm with NeonTabBar and tabbed sections"
```

---

### Task 15: Add Camera Settings Bottom Sheet to Camera Detail

**Files:**
- Modify: `app/(tabs)/cameras/[id].tsx` — Add gear icon + NeonModal with CameraSettingsForm

**Step 1: Add bottom sheet trigger**

In the camera detail page, add a gear icon button (NeonButton icon variant) that opens a `NeonModal` containing `<CameraSettingsForm cameraId={id} camera={camera} />`.

Find the existing settings button (search for "settings" icon or gear icon in the file) and replace its navigation behavior with opening the NeonModal.

The NeonModal uses `heightFraction={0.85}` to take most of the screen.

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add app/(tabs)/cameras/
git commit -m "feat: add camera settings bottom sheet to camera detail view"
```

---

## Phase 3: Events + Videoclips Unification

### Task 16: Create useUnifiedEvents Hook

**Files:**
- Create: `src/hooks/use-unified-events.ts`
- Reference: `src/types/camera.ts` (VideoClip interface, lines 293-311)
- Reference: `src/lib/eventsAppApi.ts` (DetectionGroup, DetectionEvent types)

**Step 1: Implement the unified events hook**

```typescript
// src/hooks/use-unified-events.ts
import { useMemo } from "react";
import type { DetectionGroup, DetectionEvent } from "@/lib/eventsAppApi";
import type { VideoClip } from "@/types/camera";

export interface UnifiedEventGroup extends DetectionGroup {
  linkedClips: VideoClip[];
  hasClip: boolean;
}

const CLIP_TOLERANCE_MS = 30_000; // 30 seconds tolerance for matching

export function linkEventsToClips(
  groups: DetectionGroup[],
  clips: VideoClip[]
): UnifiedEventGroup[] {
  if (!clips.length) {
    return groups.map((g) => ({ ...g, linkedClips: [], hasClip: false }));
  }

  // Sort clips by startTime for binary search potential (simple loop for now)
  return groups.map((group) => {
    const events = group.events;
    if (!events.length) {
      return { ...group, linkedClips: [], hasClip: false };
    }

    const groupStart = Math.min(...events.map((e) => e.timestamp)) - CLIP_TOLERANCE_MS;
    const groupEnd = Math.max(...events.map((e) => e.timestamp)) + CLIP_TOLERANCE_MS;
    const groupDevices = new Set(events.map((e) => e.deviceName).filter(Boolean));

    const linkedClips = clips.filter((clip) => {
      const clipEnd = clip.startTime + (clip.duration ?? 0);
      const timeOverlap = clip.startTime <= groupEnd && clipEnd >= groupStart;
      const deviceMatch = groupDevices.size === 0 || groupDevices.has(clip.deviceName);
      return timeOverlap && deviceMatch;
    });

    return { ...group, linkedClips, hasClip: linkedClips.length > 0 };
  });
}

export function useLinkedEvents(
  groups: DetectionGroup[] | undefined,
  clips: VideoClip[] | undefined
): UnifiedEventGroup[] {
  return useMemo(() => {
    if (!groups) return [];
    return linkEventsToClips(groups, clips ?? []);
  }, [groups, clips]);
}
```

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/hooks/use-unified-events.ts
git commit -m "feat: add useLinkedEvents hook for client-side event-clip linking"
```

---

### Task 17: Add Clip Filter to Events Store

**Files:**
- Modify: `src/store/eventsStore.ts` (164 LOC)

**Step 1: Add `onlyWithClips` filter**

Add to the EventsStore interface (around line 26-44):
```typescript
onlyWithClips: boolean;
setOnlyWithClips: (val: boolean) => void;
```

Add to the create() call with default `false`. Add to the persistence logic.

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/store/eventsStore.ts
git commit -m "feat: add onlyWithClips filter to events store"
```

---

### Task 18: Rebuild Unified Events Page

**Files:**
- Modify: `app/(tabs)/events.tsx` (554 LOC → significant rewrite)
- Modify: `src/components/EventsGroupElement.tsx` (685 LOC → add clip badge)
- Modify: `src/components/EventsFiltersToolbar.tsx` (714 LOC → merge videoclip filters)

**Step 1: Add videoclips query to events.tsx**

In events.tsx, add a second `useInfiniteQuery` (or `useQuery`) for videoclips alongside the existing events query. This can be adapted from `videoclips.tsx` (lines 156-229). Run both queries in parallel.

Pass both results through `useLinkedEvents()` to produce `UnifiedEventGroup[]`.

Apply the `onlyWithClips` filter from the store: if true, filter to only groups where `hasClip === true`.

**Step 2: Add clip badge to EventsGroupElement**

In the card rendering (around lines 131-190), add a clip indicator. When the group has `hasClip === true`:
- Show a small blue pill badge in the bottom-right with play icon + duration of first linked clip
- The badge is a `TouchableOpacity` that calls a new `onClipPress` callback prop

Pass `linkedClips` and `hasClip` through the props.

**Step 3: Add clip filter to EventsFiltersToolbar**

Add a new chip/toggle to the toolbar for "Only with clips" filter:
- NeonChip with film icon
- Reads `onlyWithClips` from events store
- Toggles `setOnlyWithClips`

Remove the separate source/label filters that only existed in events, keeping the merged set of filters.

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add app/(tabs)/events.tsx src/components/EventsGroupElement.tsx src/components/EventsFiltersToolbar.tsx
git commit -m "feat: unify events page with videoclip linking and clip badges"
```

---

### Task 19: Add Inline Clip Player to Event Detail Modal

**Files:**
- Modify: `src/components/EventsGroupElement.tsx` — Enhance modal section

**Step 1: Add clip player section to the event detail modal**

In the modal (around lines 192-291), after the metadata section, add a "Related Clip" section that renders only when the group has a linked clip.

The clip section shows:
- A thumbnail of the clip (from `linkedClips[0].thumbnailUrl`)
- A play button overlay
- Tapping opens `VideoclipDetailModal` (imported from existing component) with the clip data

This reuses the existing `VideoclipDetailModal` rather than building a new inline player — simpler and already handles WebRTC/HTTP playback.

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/EventsGroupElement.tsx
git commit -m "feat: add related clip section to event detail modal"
```

---

### Task 20: Remove Videoclips Tab from Navigation

**Files:**
- Modify: `app/(tabs)/_layout.tsx` (line ~127: remove videoclips screen)
- Modify: `src/components/BottomNav.tsx` (lines 12-18: remove videoclips from navItems)
- Modify: `src/components/SideNav.tsx` (lines 18-24: remove videoclips from navItems)
- Delete: `app/(tabs)/videoclips.tsx` (595 LOC)
- Delete: `src/components/VideoclipFiltersToolbar.tsx` (603 LOC)

**Step 1: Remove videoclips tab from _layout.tsx**

In `app/(tabs)/_layout.tsx`, remove the `<Tabs.Screen name="videoclips" ... />` entry (around line 127).

**Step 2: Remove videoclips from BottomNav navItems**

In `src/components/BottomNav.tsx`, remove the `{ path: "/videoclips", key: "videoclips", icon: "film" }` entry from the navItems array (line 16).

**Step 3: Remove videoclips from SideNav navItems**

Same removal in `src/components/SideNav.tsx` (line 22).

**Step 4: Delete videoclips.tsx and VideoclipFiltersToolbar.tsx**

Remove the files entirely. The VideoclipDetailModal and VideoclipElement components are kept — they're reused by the unified events page.

**Step 5: Verify**

Run: `npm run ts-check`
Fix any broken imports or references.

**Step 6: Commit**

```bash
git add app/(tabs)/_layout.tsx src/components/BottomNav.tsx src/components/SideNav.tsx
git rm app/(tabs)/videoclips.tsx src/components/VideoclipFiltersToolbar.tsx
git commit -m "feat: remove videoclips tab, merge functionality into events"
```

---

## Phase 4: Full App Reskin

### Task 21: Restyle Navigation (BottomNav + SideNav + AppHeader)

**Files:**
- Modify: `src/components/BottomNav.tsx` (142 LOC)
- Modify: `src/components/SideNav.tsx` (200 LOC)
- Modify: `src/components/AppHeader.tsx` (45 LOC)

**Step 1: Restyle BottomNav**

Replace all `useThemeColors()` usage with neon tokens:
- Container background: `neon.bg` (#000)
- Border top: `neon.borderSubtle` (#1a1a1a)
- Active icon color: `neon.accent` (#007AFF)
- Inactive icon color: `neon.textSecondary` (#888)
- Active label color: `neon.accent`
- Inactive label color: `neon.textSecondary`

**Step 2: Restyle SideNav**

Same approach:
- Container background: `neon.bgElevated` (#0A0A0A)
- Border right: `neon.borderSubtle`
- Same icon/label coloring as BottomNav

**Step 3: Restyle AppHeader**

- Background: transparent (page bg shows through)
- Text color: `neon.textPrimary`
- Remove border bottom
- Title: `type.size["3xl"]`, `type.weight.bold`

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add src/components/BottomNav.tsx src/components/SideNav.tsx src/components/AppHeader.tsx
git commit -m "feat: restyle navigation components with neon design system"
```

---

### Task 22: Restyle Cameras Grid Page

**Files:**
- Modify: `app/(tabs)/cameras/index.tsx` (~775 LOC)
- Modify: `src/components/CameraCard.tsx` (244 LOC)
- Modify: `src/components/DeviceStatusPills.tsx`

**Step 1: Restyle cameras/index.tsx**

Replace all `useThemeColors()` with neon tokens:
- Page background: `neon.bg`
- FAB buttons: Use `NeonButton variant="fab"`
- Empty state text: `neon.textSecondary`
- Section headers: neon typography tokens
- Modal backgrounds: `neon.bgElevated`

**Step 2: Restyle CameraCard**

Replace hardcoded colors:
- Card background (`#1C1C1E` at line ~87): `neon.bgElevated`
- Top band overlay: keep `rgba(0,0,0,0.65)` (already dark)
- Name text: already `#fff` (fine)
- Border radius: use `radius.lg`
- Update any `useThemeColors()` usage

**Step 3: Restyle DeviceStatusPills**

Replace any theme-dependent colors with neon event colors or neon accent. Status pills should use the neon event color palette for detection-related statuses.

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add app/(tabs)/cameras/index.tsx src/components/CameraCard.tsx src/components/DeviceStatusPills.tsx
git commit -m "feat: restyle cameras grid with neon design system"
```

---

### Task 23: Restyle Camera Detail and Grid View

**Files:**
- Modify: `app/(tabs)/cameras/[id].tsx` — Replace theme colors with neon tokens
- Modify: `app/(tabs)/grids/[id]/index.tsx` — Replace theme colors with neon tokens
- Modify: `src/components/StreamControlsOverlay.tsx` — Neon button styles

**Step 1: Restyle camera detail**

The camera detail page is already mostly dark (#000 background). Replace any remaining `useThemeColors()` calls with neon tokens:
- Drawer background: `neon.bgElevated`
- Toolbar: `neon.bgSurface`
- Text: `neon.textPrimary` / `neon.textSecondary`
- Borders: `neon.borderSubtle`

**Step 2: Restyle grid view**

Same approach — replace `useThemeColors()` with neon tokens. Controls overlay buttons → neon styling.

**Step 3: Restyle StreamControlsOverlay**

Replace any theme color usage with neon tokens. Playback controls, quality selectors use neon components.

**Step 4: Verify**

Run: `npm run ts-check`

**Step 5: Commit**

```bash
git add app/(tabs)/cameras/ app/(tabs)/grids/ src/components/StreamControlsOverlay.tsx
git commit -m "feat: restyle camera detail and grid view with neon tokens"
```

---

### Task 24: Restyle Events Page and Event Components

**Files:**
- Modify: `app/(tabs)/events.tsx` — Background and list styling
- Modify: `src/components/EventsGroupElement.tsx` — Card and modal styling
- Modify: `src/components/EventsFiltersToolbar.tsx` — Filter chips styling
- Modify: `src/components/ReelDetailModal.tsx` (504 LOC) — Neon modal styling
- Modify: `src/components/VideoclipDetailModal.tsx` (535 LOC) — Neon modal styling

**Step 1: Restyle events.tsx**

- Page background: `neon.bg`
- Time row headers: `neon.textSecondary`, `type.size.sm`
- Loading indicator: `neon.accent`
- Replace all `useThemeColors()` with neon tokens

**Step 2: Restyle EventsGroupElement card**

- Card background: `neon.bgOverlay`
- Border radius: `radius.md`
- Badge colors: use `neon.event[className]` for detection class colors
- Modal background: `neon.bgElevated`
- Modal text: neon typography tokens
- Close button: `neon.textSecondary`

**Step 3: Restyle EventsFiltersToolbar**

Replace all filter chips with NeonChip or NeonButton chip variant. Replace modal backgrounds with neon tokens. Date navigation uses neon styling.

**Step 4: Restyle ReelDetailModal**

Replace background with `neon.bgElevated`, text colors with neon tokens, navigation buttons with NeonButton.

**Step 5: Restyle VideoclipDetailModal**

Same approach — neon background, neon text, neon buttons for controls.

**Step 6: Verify**

Run: `npm run ts-check`

**Step 7: Commit**

```bash
git add app/(tabs)/events.tsx src/components/EventsGroupElement.tsx src/components/EventsFiltersToolbar.tsx src/components/ReelDetailModal.tsx src/components/VideoclipDetailModal.tsx
git commit -m "feat: restyle events page and modals with neon design system"
```

---

### Task 25: Restyle Remaining Modals and Components

**Files:**
- Modify: `src/components/AddIntegrationModal.tsx`
- Modify: `src/components/CameraAssociatedDevicesModal.tsx`
- Modify: `src/components/EventsReel.tsx`
- Modify: `src/components/EventsReel.web.tsx` (if exists)
- Modify: `src/components/PtzPanel.tsx`
- Modify: `src/components/DevicesPanel.tsx`

**Step 1: Restyle each component**

For each component:
- Replace `useThemeColors()` with direct neon token imports
- Replace backgrounds with neon surface colors
- Replace text colors with neon text tokens
- Replace borders with neon border tokens
- Replace interactive elements with NeonButton where appropriate

**Step 2: Verify**

Run: `npm run ts-check`

**Step 3: Commit**

```bash
git add src/components/
git commit -m "feat: restyle remaining modals and components with neon design system"
```

---

## Phase 5: Cleanup

### Task 26: Remove Old Theme System

**Files:**
- Delete: `src/theme/colors.ts` (50 LOC)
- Delete: `src/components/ThemeProvider.tsx` (27 LOC)
- Modify: `src/hooks/use-theme-colors.ts` (12 LOC) — Delete or make it return neon tokens for backward compat
- Modify: `src/hooks/use-general-settings.ts` (187 LOC) — Remove themeMode from GeneralSettings
- Search and replace: All remaining `useThemeColors()` calls across the entire codebase

**Step 1: Find all remaining useThemeColors usages**

Run: `grep -r "useThemeColors" src/ app/` to find every file still using the old hook.

**Step 2: Replace each usage**

For each file:
- Remove `const colors = useThemeColors();`
- Replace `colors.background` → `neon.bg`
- Replace `colors.backgroundSecondary` → `neon.bgElevated`
- Replace `colors.text` → `neon.textPrimary`
- Replace `colors.textSecondary` → `neon.textSecondary`
- Replace `colors.tint` → `neon.accent`
- Replace `colors.border` → `neon.border`
- Replace `colors.surface` → `neon.bgElevated`
- Replace `colors.headerBg` → `neon.bgSurface`
- Replace `colors.headerBorder` → `neon.borderSubtle`
- Replace `colors.headerText` → `neon.textPrimary`
- Replace `colors.bottomNavBg` → `neon.bg`
- Replace `colors.modalBg` → `neon.bgElevated`
- Replace `colors.modalOverlay` → `"rgba(0,0,0,0.6)"`
- Replace `colors.inputBg` → `neon.bgInput`
- Replace `colors.inputBorder` → `neon.borderInput`
- Replace `colors.cardBg` → `neon.bgElevated`
- Replace `colors.sectionBg` → `neon.bgElevated`
- Replace `colors.tabActiveBg` → `neon.accentActive`
- Replace `colors.tabInactiveText` → `neon.textSecondary`
- Add `import { neon } from "@/theme/neon"` to each file

**Step 3: Remove ThemeMode from settings**

In `src/hooks/use-general-settings.ts`:
- Remove `ThemeMode` type export (line 12)
- Remove `themeMode` from `GeneralSettings` interface (line 23)
- Remove theme-related persistence keys
- Remove `effectiveTheme` computation (lines 134-139)
- Remove `Appearance.setColorScheme` sync (lines 141-150)

**Step 4: Delete files**

```bash
rm src/theme/colors.ts
rm src/components/ThemeProvider.tsx
rm src/hooks/use-theme-colors.ts
```

**Step 5: Remove ThemeProvider from app root**

Find where `<ThemeProvider>` is rendered in the app root layout and remove it.

**Step 6: Delete SettingsTabs.tsx if not already deleted**

```bash
rm src/components/SettingsTabs.tsx
```

**Step 7: Verify**

Run: `npm run ts-check`
Fix any remaining type errors from removed exports/imports.

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove old light/dark theme system, migrate all to neon tokens"
```

---

### Task 27: Final Verification and Cleanup

**Step 1: Full TypeScript check**

Run: `npm run ts-check`
Fix any remaining errors.

**Step 2: Lint check**

Run: `npm run lint`
Fix any lint issues.

**Step 3: Search for orphaned imports**

Search for any remaining references to deleted files:
- `colors.ts` (old theme)
- `ThemeProvider`
- `useThemeColors`
- `SettingsTabs`
- `VideoclipFiltersToolbar`
- `videoclips.tsx` route

**Step 4: Verify app starts**

Run: `npm run web` to verify the web build works.
Run: `npm run start:dev` to verify the dev server starts.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification of neon UI refactor"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1: Foundation | 1-7 | Design tokens + 9 primitive components |
| 2: Settings | 8-15 | Dark mode, settings hub, appearance/cameras/integrations/advanced pages, camera settings bottom sheet |
| 3: Events Unification | 16-20 | Unified events hook, clip filter, merged page, inline clip player, remove videoclips tab |
| 4: App Reskin | 21-25 | Navigation, cameras grid, camera detail, grid view, events, modals |
| 5: Cleanup | 26-27 | Remove old theme system, final verification |

**Total: 27 tasks across 5 phases**

Each task produces a working commit. Phase 1 can run without affecting the existing app. Phases 2-4 progressively migrate screens. Phase 5 removes the old system once everything is migrated.

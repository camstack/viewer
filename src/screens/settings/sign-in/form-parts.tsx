/**
 * The two form primitives the Sign-in methods panels share: a labelled text
 * field and a button. Kept local to these panels — the rest of Settings is
 * rows and switches, and a general form kit would be a second design language.
 */
import React, { useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "../../../lib/icons.js";
import { useTheme } from "../../../theme/theme-provider.js";
import { RADIUS, SPACING } from "../../../theme/tokens.js";

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly secure?: boolean;
  readonly keyboardType?: TextInputProps["keyboardType"];
  readonly autoComplete?: TextInputProps["autoComplete"];
  readonly testID?: string;
  readonly maxLength?: number;
}

export function Field({
  label,
  value,
  onChangeText,
  secure,
  keyboardType,
  autoComplete,
  testID,
  maxLength,
}: FieldProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  // A secret field carries the same show / hide eye as the sign-in screen.
  const [revealed, setRevealed] = useState(false);
  const hidden = secure === true && !revealed;
  return (
    <View style={{ gap: SPACING.xs }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
        {label}
      </Text>
      <View style={{ position: "relative", justifyContent: "center" }}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          {...(keyboardType !== undefined ? { keyboardType } : {})}
          {...(autoComplete !== undefined ? { autoComplete } : {})}
          {...(maxLength !== undefined ? { maxLength } : {})}
          accessibilityLabel={label}
          style={{
            color: colors.foreground,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.md,
            paddingVertical: SPACING.sm,
            fontSize: 15,
            ...(secure === true ? { paddingRight: 44 } : {}),
          }}
        />
        {secure === true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              revealed ? t("v2.login.hidePassword") : t("v2.login.showPassword")
            }
            onPress={() => setRevealed((r) => !r)}
            hitSlop={8}
            style={{ position: "absolute", right: SPACING.lg }}
          >
            {revealed ? (
              <EyeOff color={colors.foregroundSubtle} size={20} />
            ) : (
              <Eye color={colors.foregroundSubtle} size={20} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A padded block inside a Section card, for a form or an explanation. */
export function Panel({ children }: { readonly children: React.ReactNode }) {
  return (
    <View style={{ padding: SPACING.xl, gap: SPACING.md }}>{children}</View>
  );
}

export function PanelText({
  children,
  tone = "muted",
}: {
  readonly children: React.ReactNode;
  readonly tone?: "muted" | "danger";
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        color: tone === "danger" ? colors.danger : colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 18,
      }}
    >
      {children}
    </Text>
  );
}

import Briefcase01Icon from "@hugeicons/core-free-icons/Briefcase01Icon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import File02Icon from "@hugeicons/core-free-icons/File02Icon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import { Tabs } from "expo-router/js-tabs";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts } from "../../../shared/theme";
import { Icon, screenWidth } from "../../../shared/ui";

const tabs = [
  { name: "(today)", title: "Hoje", icon: Home01Icon },
  { name: "(departure)", title: "Saída", icon: CheckListIcon },
  { name: "(career)", title: "Carreira", icon: Briefcase01Icon },
  { name: "(resume)", title: "Currículo", icon: File02Icon },
  { name: "(profile)", title: "Perfil", icon: UserCircleIcon },
];

const tabHorizontalPadding = 5;
const defaultLabelWidth = 50;

export default function JourneyTabs() {
  const { bottom } = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const tabWidth = Math.min(width, screenWidth) / tabs.length;

  const labelWidth = tabWidth - 2 * tabHorizontalPadding;
  const labelScale = Math.min(fontScale, 1.3, Math.max(1, labelWidth / defaultLabelWidth));
  const labelLineHeight = 16 * labelScale;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: "below-icon",
        tabBarAllowFontScaling: false,
        tabBarStyle: [styles.bar, { height: 42 + labelLineHeight + bottom }],
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarLabel: ({ color }) => (
              <Text
                allowFontScaling={false}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                numberOfLines={1}
                style={[
                  styles.label,
                  { color, fontSize: 12 * labelScale, lineHeight: labelLineHeight },
                ]}
              >
                {tab.title}
              </Text>
            ),
            tabBarIcon: ({ focused }) => (
              <View style={[styles.icon, focused && styles.active]}>
                <Icon
                  name={tab.icon}
                  color={focused ? colors.primary : colors.mutedForeground}
                  size={20}
                />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { alignSelf: "stretch", textAlign: "center", fontFamily: fonts.bold },
  bar: {
    width: "100%",
    maxWidth: screenWidth,
    alignSelf: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    elevation: 0,
  },
  icon: { width: 42, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: colors.tint },
});

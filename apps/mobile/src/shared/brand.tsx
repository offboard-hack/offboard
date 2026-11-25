import { View, StyleSheet } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";
import { colors, fonts } from "./theme";
import { Text } from "./ui";

const openArc = "M-102.601 -17A104 104 0 0 1 102.601 -17H55.453A58 58 0 0 0 -55.453 -17Z";

export function Brand() {
  return (
    <View style={styles.brand} accessible accessibilityLabel="Offboard">
      <Svg width={30} height={30} viewBox="0 0 256 256" aria-hidden>
        <Rect width="256" height="256" rx="59" fill={colors.primary} />
        <G fill={colors.primaryForeground} transform="translate(26 26) scale(.797)">
          <G transform="translate(128 128) rotate(-38)">
            <Path d={openArc} />
            <Path d={openArc} transform="rotate(180)" />
          </G>
        </G>
      </Svg>
      <Text maxFontSizeMultiplier={1.5} style={styles.wordmark}>
        offboard
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  wordmark: { fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: -1.1, lineHeight: 30 },
});

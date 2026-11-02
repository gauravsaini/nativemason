import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LayoutProvider, LayoutView, LayoutText, LayoutPressable } from '@rn-layout/runtime';

function FooterScenario() {
  const insets = useSafeAreaInsets();
  return <LayoutView layoutId="screen" style={styles.screen}>
    <LayoutText layoutId="heading" style={styles.heading}>Layout bridge fixture</LayoutText>
    <LayoutText layoutId="description" style={styles.description}>The footer should place both buttons in one row with a 12 point gap.</LayoutText>
    <LayoutView layoutId="footer" style={styles.footer}>
      <LayoutPressable layoutId="cancel" accessibilityRole="button" style={styles.button} onPress={() => {}}><LayoutText layoutId="cancel-label" style={styles.label}>Cancel</LayoutText></LayoutPressable>
      <LayoutPressable layoutId="submit" accessibilityRole="button" style={styles.buttonPrimary} onPress={() => {}}><LayoutText layoutId="submit-label" style={styles.label}>Submit</LayoutText></LayoutPressable>
    </LayoutView>
    <LayoutView layoutId="safe-bottom" style={{ height: insets.bottom }} />
  </LayoutView>;
}
export default function App() {
  const scenarioId = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search).get('scenario') ?? 'broken-footer' : process.env.EXPO_PUBLIC_LAYOUT_SCENARIO ?? 'broken-footer';
  return <SafeAreaProvider><LayoutProvider scenarioId={scenarioId} nativeUrl={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_URL} nativeToken={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN}><FooterScenario /></LayoutProvider></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingTop: 48 },
  heading: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  description: { fontSize: 16, lineHeight: 24, color: '#475569', marginTop: 12 },
  footer: { flexDirection: 'column', gap: 12, marginTop: 'auto', paddingVertical: 12 },
  button: { width: 176, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: '#64748b' },
  buttonPrimary: { width: 176, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: '#2563eb' },
  label: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
});

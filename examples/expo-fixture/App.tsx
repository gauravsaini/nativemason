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
export function ScenarioContent({ scenarioId }: { scenarioId: string }) {
  switch (scenarioId) {
    case 'broken-footer': return <FooterScenario />;
    case 'text-wrapping': return <LayoutView layoutId="screen" style={styles.screen}>
      <LayoutView layoutId="wrapping-container" style={scenarioStyles.wrappingContainer}>
        <LayoutText layoutId="wrapping-copy" style={scenarioStyles.wrappingCopy}>A long description wraps across several lines while its action remains below the complete text block.</LayoutText>
        <LayoutPressable layoutId="wrapping-action" accessibilityRole="button" style={scenarioStyles.wrappingAction}><LayoutText layoutId="wrapping-label" style={styles.label}>Continue</LayoutText></LayoutPressable>
      </LayoutView>
    </LayoutView>;
    case 'safe-area': return <LayoutView layoutId="screen" style={styles.screen}>
      <LayoutText layoutId="safe-heading" style={styles.heading}>Deliberate safe-area violation</LayoutText>
      <LayoutPressable layoutId="safe-action" accessibilityRole="button" style={scenarioStyles.unsafeAction}><LayoutText layoutId="safe-label" style={styles.label}>Bottom action</LayoutText></LayoutPressable>
    </LayoutView>;
    case 'intentional-overlap': return <LayoutView layoutId="screen" style={styles.screen}>
      <LayoutText layoutId="overlap-heading" style={styles.heading}>Intentional layering</LayoutText>
      <LayoutView layoutId="overlap-stage" style={scenarioStyles.overlapStage}>
        <LayoutView layoutId="overlap-a" style={scenarioStyles.overlapA}><LayoutText layoutId="overlap-a-label" style={styles.label}>Back layer</LayoutText></LayoutView>
        <LayoutView layoutId="overlap-b" style={scenarioStyles.overlapB}><LayoutText layoutId="overlap-b-label" style={styles.label}>Front layer</LayoutText></LayoutView>
      </LayoutView>
    </LayoutView>;
    case 'repeated-elements': return <LayoutView layoutId="screen" style={styles.screen}>
      <LayoutText layoutId="repeat-heading" style={styles.heading}>Repeated source site</LayoutText>
      <LayoutView layoutId="repeated-list" style={scenarioStyles.repeatedList}>
        {['one', 'two', 'three'].map(item => <LayoutPressable key={item} layoutId={'repeat-' + item} accessibilityRole="button" style={scenarioStyles.repeatedButton}><LayoutText layoutId={'repeat-label-' + item} style={styles.label}>Item {item}</LayoutText></LayoutPressable>)}
      </LayoutView>
    </LayoutView>;
    default: throw new Error('Unsupported layout fixture scenario: ' + scenarioId);
  }
}

export default function App() {
  const scenarioId = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search).get('scenario') ?? 'broken-footer' : process.env.EXPO_PUBLIC_LAYOUT_SCENARIO ?? 'broken-footer';
  return <SafeAreaProvider><LayoutProvider rootId="screen" scenarioId={scenarioId} nativeUrl={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_URL} nativeToken={process.env.EXPO_PUBLIC_LAYOUT_NATIVE_TOKEN}><ScenarioContent scenarioId={scenarioId} /></LayoutProvider></SafeAreaProvider>;
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

const scenarioStyles = StyleSheet.create({
  wrappingContainer: { width: 240, marginTop: 24 },
  wrappingCopy: { fontSize: 16, lineHeight: 24, color: '#334155' },
  wrappingAction: { height: 48, marginTop: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2563eb' },
  unsafeAction: { width: 176, height: 48, marginTop: 'auto', justifyContent: 'center', alignItems: 'center', backgroundColor: '#dc2626' },
  overlapStage: { width: 240, height: 180, marginTop: 24 },
  overlapA: { position: 'absolute', left: 0, top: 0, width: 120, height: 120, backgroundColor: '#475569', padding: 8 },
  overlapB: { position: 'absolute', left: 40, top: 20, width: 120, height: 120, backgroundColor: '#2563eb', padding: 8 },
  repeatedList: { marginTop: 24, gap: 8 },
  repeatedButton: { width: 240, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2563eb' },
});

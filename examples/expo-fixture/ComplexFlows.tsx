import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Keyboard } from 'react-native';
import { registerScenarioHook } from '@nativemason/runtime';
import { checkoutStyles, spacing } from './theme';

/** Uses unmodified RN host components; Babel instruments this development source. */
export function ComplexFlow({ scenarioId }: { scenarioId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => registerScenarioHook('resetCheckout', () => { setEmail(''); setExpanded(false); setSubmitted(false); Keyboard.dismiss(); }), []);
  return <View testID="screen" style={checkoutStyles.screen}>
    <Text testID="checkout-heading" style={checkoutStyles.text}>Checkout details</Text>
    <ScrollView testID="checkout-scroll" keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
      <TextInput testID="checkout-email" accessibilityLabel="Email address" placeholder="Email address" keyboardType="email-address" value={email} onChangeText={setEmail} style={checkoutStyles.input} />
      <Pressable testID="checkout-toggle" accessibilityRole="button" onPress={() => setExpanded(value => !value)} style={[checkoutStyles.action, expanded ? { marginTop: spacing.comfortable } : { marginTop: spacing.compact }]}>
        <Text testID="checkout-toggle-label" style={checkoutStyles.text}>{expanded ? 'Hide details' : 'Show details'}</Text>
      </Pressable>
      {expanded ? <Text testID="checkout-details" style={checkoutStyles.text}>Your order includes shipping and local taxes.</Text> : null}
      <Text testID="checkout-summary" numberOfLines={scenarioId === 'text-truncation' ? 1 : undefined} style={[checkoutStyles.text, { width: 160 }]}>A deliberately long product description needs enough room to display completely without truncation.</Text>
      {scenarioId === 'scroll-checkout' ? Array.from({ length: 12 }, (_, index) => <Text key={index} testID={'checkout-row-' + index} style={[checkoutStyles.text, { marginTop: 16 }]}>Order item {index + 1}</Text>) : null}
      <Pressable testID="checkout-submit" accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setSubmitted(true); }} style={checkoutStyles.action}>
        <Text testID="checkout-submit-label" style={checkoutStyles.text}>Confirm order</Text>
      </Pressable>
      {submitted ? <Text testID="checkout-success" style={checkoutStyles.text}>Order confirmed</Text> : null}
    </ScrollView>
  </View>;
}

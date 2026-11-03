import { StyleSheet } from 'react-native';
export const spacing = { compact: 8, comfortable: 16 } as const;
export const checkoutStyles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.comfortable, paddingTop: 48, backgroundColor: '#f8fafc' },
  input: { height: 48, width: '100%', borderWidth: 1, borderColor: '#64748b', paddingHorizontal: spacing.compact },
  action: { minHeight: 48, padding: spacing.comfortable, backgroundColor: '#2563eb', marginTop: spacing.compact },
  text: { fontSize: 16, lineHeight: 24 },
});

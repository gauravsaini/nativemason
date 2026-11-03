import React from 'react';
import {Text} from 'react-native';
import {checkoutStyles} from './theme';
export function OrderSummary({truncated}:{truncated:boolean}) {
  return <Text testID="checkout-summary" numberOfLines={truncated ? 1 : undefined} style={[checkoutStyles.text, {width:160}]}>A deliberately long product description needs enough room to display completely without truncation.</Text>;
}

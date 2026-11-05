import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
export function NativeWindFlow() {
  const [wide, setWide] = useState(false);
  return <View testID="screen" className="flex-1 bg-slate-50 p-comfortable pt-12">
    <Text testID="utility-heading" className="text-lg leading-6">Utility style trial</Text>
    <View testID="utility-footer" className={wide ? 'flex-row gap-4 mt-4' : 'flex-col gap-2 mt-4'}>
      <Pressable testID="utility-cancel" className="h-12 w-40 items-center justify-center bg-slate-600" onPress={() => setWide(value => !value)}><Text testID="utility-cancel-label" className="text-base text-white">Toggle layout</Text></Pressable>
      <Pressable testID="utility-submit" className="h-12 w-40 items-center justify-center bg-blue-600"><Text testID="utility-submit-label" className="text-base text-white">Continue</Text></Pressable>
    </View>
  </View>;
}

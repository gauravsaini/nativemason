import { cssInterop } from 'nativewind';
import { LayoutImage, LayoutPressable, LayoutScrollView, LayoutText, LayoutTextInput, LayoutView } from './components/index.js';

// Import this optional entry once after NativeWind configuration. It keeps
// className resolution active when development transforms replace RN hosts.
cssInterop(LayoutView, { className: 'style' });
cssInterop(LayoutText, { className: 'style' });
cssInterop(LayoutPressable, { className: 'style' });
cssInterop(LayoutTextInput, { className: 'style' });
cssInterop(LayoutImage, { className: 'style' });
cssInterop(LayoutScrollView, { className: 'style', contentContainerClassName: 'contentContainerStyle' });
export { LayoutImage, LayoutPressable, LayoutScrollView, LayoutText, LayoutTextInput, LayoutView };

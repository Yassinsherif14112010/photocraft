/**
 * UI kit — the premium component layer every screen is built from.
 * Micro-interactions use the built-in Animated API (spring presses, sliding
 * sheets, toasts, segmented indicators) so the whole app feels alive without
 * adding native dependencies. Everything is theme-aware and RTL-safe.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {Palette, useTheme} from '../theme';

// -------------------------------------------------------- reduced motion

let reduceMotion = false;
const rmListeners = new Set<() => void>();
function setReduceMotion(v: boolean) {
  if (v !== reduceMotion) {
    reduceMotion = v;
    rmListeners.forEach(l => l());
  }
}
AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

/** True when the OS asks for reduced motion — animations collapse to fades. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    l => {
      rmListeners.add(l);
      return () => rmListeners.delete(l);
    },
    () => reduceMotion,
    () => false,
  );
}

// ---------------------------------------------------------------- Pressable

/** Pressable with a springy scale — the app-wide tactile feedback. */
export function PressableScale({
  onPress,
  style,
  children,
  disabled,
  scaleTo = 0.96,
  accessibilityLabel,
}: {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  disabled?: boolean;
  scaleTo?: number;
  accessibilityLabel?: string;
}) {
  const anim = useRef(new Animated.Value(1)).current;
  const reduce = useReducedMotion();
  const pressIn = useCallback(() => {
    if (reduce) {
      return; // respect reduced-motion: no scale bounce
    }
    Animated.spring(anim, {toValue: scaleTo, useNativeDriver: true, speed: 40, bounciness: 4}).start();
  }, [anim, scaleTo, reduce]);
  const pressOut = useCallback(() => {
    if (reduce) {
      return;
    }
    Animated.spring(anim, {toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6}).start();
  }, [anim, reduce]);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}>
      <Animated.View style={[{transform: [{scale: anim}]}, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ Buttons

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'accent',
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger' | 'neutral';
}) {
  const c = useTheme();
  const bg = tone === 'accent' ? c.accent : tone === 'danger' ? c.danger : c.surface3;
  return (
    <PressableScale onPress={onPress} disabled={disabled} scaleTo={0.97} accessibilityLabel={label}>
      <View style={[styles.primaryBtn, {backgroundColor: bg}, disabled && {opacity: 0.4}]} accessibilityRole="button">
        <Text style={[styles.primaryBtnText, {color: tone === 'neutral' ? c.text : c.onAccent}]}>{label}</Text>
      </View>
    </PressableScale>
  );
}

export function GhostButton({label, onPress, color}: {label: string; onPress?: () => void; color?: string}) {
  const c = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label}>
      <View style={styles.ghostBtn} accessibilityRole="button">
        <Text style={[styles.ghostBtnText, {color: color ?? c.accent2}]}>{label}</Text>
      </View>
    </PressableScale>
  );
}

export function IconButton({
  glyph,
  onPress,
  active,
  danger,
  size = 40,
  label,
}: {
  glyph: string;
  onPress?: () => void;
  active?: boolean;
  danger?: boolean;
  size?: number;
  label?: string;
}) {
  const c = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label}>
      <View
        style={[
          styles.iconBtn,
          {
            width: size,
            height: size,
            borderRadius: size * 0.3,
            backgroundColor: active ? c.accent : c.surface2,
            borderWidth: 1,
            borderColor: active ? c.accent : c.border,
          },
        ]}>
        <Text style={{color: danger ? c.danger : active ? c.onAccent : c.text, fontSize: size * 0.46, fontWeight: '700'}}>{glyph}</Text>
      </View>
    </PressableScale>
  );
}

// --------------------------------------------------------------------- Chip

export function Chip({
  label,
  active,
  onPress,
  small,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  small?: boolean;
}) {
  const c = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} scaleTo={0.94}>
      <View
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityState={onPress ? {selected: !!active} : undefined}
        style={[
          styles.chip,
          small && styles.chipSmall,
          {backgroundColor: active ? c.accent : c.surface2, borderColor: active ? c.accent : c.border},
        ]}>
        <Text style={[styles.chipText, small && {fontSize: 11}, {color: active ? c.onAccent : c.textDim}]}>{label}</Text>
      </View>
    </PressableScale>
  );
}

export function Badge({text, tone = 'neutral'}: {text: string; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'accent'}) {
  const c = useTheme();
  const map: Record<string, {bg: string; fg: string}> = {
    neutral: {bg: c.surface3, fg: c.textDim},
    success: {bg: c.successSoft, fg: c.success},
    warn: {bg: c.accentSoft, fg: c.warn},
    danger: {bg: c.dangerSoft, fg: c.danger},
    accent: {bg: c.accentSoft, fg: c.accent},
  };
  const t = map[tone] ?? map.neutral;
  return (
    <View style={[styles.badge, {backgroundColor: t.bg}]}>
      <Text style={[styles.badgeText, {color: t.fg}]}>{text}</Text>
    </View>
  );
}

// -------------------------------------------------------------------- Cards

export function Card({
  children,
  style,
  onPress,
  active,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  active?: boolean;
}) {
  const c = useTheme();
  const body = <View style={[styles.card, {backgroundColor: c.surface, borderColor: active ? c.accent : c.border}, active && cardActiveShadow, style]}>{children}</View>;
  return onPress ? (
    <PressableScale onPress={onPress} scaleTo={0.98}>
      {body}
    </PressableScale>
  ) : (
    body
  );
}

const cardActiveShadow = {
  shadowColor: '#3B82F6',
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: {width: 0, height: 4},
  elevation: 6,
} as const;

export function SectionLabel({text, action}: {text: string; action?: React.ReactNode}) {
  const c = useTheme();
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionLabel, {color: c.textDim}]}>{text}</Text>
      {action}
    </View>
  );
}

export function Divider() {
  const c = useTheme();
  return <View style={[styles.divider, {backgroundColor: c.border}]} />;
}

// -------------------------------------------------------------- Slider rows

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format,
  onBegin,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  format?: (v: number) => string;
  onBegin?: () => void;
}) {
  const c = useTheme();
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={[styles.sliderLabel, {color: c.textDim}]}>{label}</Text>
        <Text style={[styles.sliderValue, {color: c.text}]}>{format ? format(value) : Math.round(value)}</Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onSlidingStart={onBegin}
        onValueChange={onChange}
        onSlidingComplete={onCommit}
        minimumTrackTintColor={c.accent}
        maximumTrackTintColor={c.surface3}
        thumbTintColor={c.accent}
      />
    </View>
  );
}

export function SwitchRow({label, value, onChange}: {label: string; value: boolean; onChange: (v: boolean) => void}) {
  const c = useTheme();
  return (
    <View style={[styles.switchRow, {borderColor: c.border}]}>
      <Text style={[styles.switchLabel, {color: c.text}]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{true: c.accent, false: c.surface3}} thumbColor="#fff" accessibilityLabel={label} />
    </View>
  );
}

// ------------------------------------------------------------------- Inputs

export function TextInputRow({
  value,
  onChange,
  placeholder,
  multiline,
  rtl,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rtl?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <TextInput
      style={[
        styles.input,
        {backgroundColor: c.surface2, color: c.text, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left'},
        multiline && styles.inputMultiline,
        style,
      ]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.textFaint}
      multiline={multiline}
      autoCapitalize="none"
    />
  );
}

export function SearchBar({value, onChange, placeholder}: {value: string; onChange: (v: string) => void; placeholder: string}) {
  const c = useTheme();
  return (
    <View style={[styles.searchWrap, {backgroundColor: c.surface2, borderColor: c.border}]}>
      <Text style={[styles.searchIcon, {color: c.textFaint}]}>⌕</Text>
      <TextInput
        style={[styles.searchInput, {color: c.text}]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textFaint}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Text style={[styles.searchClear, {color: c.textFaint}]}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- Segmented

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{value: T; label: string}>;
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  const anim = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.timing(anim, {toValue: idx, duration: 180, easing: Easing.out(Easing.ease), useNativeDriver: true}).start();
  }, [idx, anim]);
  const segW = 100 / options.length;
  return (
    <View style={[styles.segmented, {backgroundColor: c.surface2, borderColor: c.border}]}>
      <Animated.View
        style={[
          styles.segIndicator,
          {
            width: `${segW}%`,
            backgroundColor: c.surface,
            transform: [{translateX: anim.interpolate({inputRange: [0, options.length - 1], outputRange: ['0%', `${100}%`]})}],
          },
        ]}
      />
      {options.map(o => (
        <Pressable key={o.value} style={styles.segOption} onPress={() => onChange(o.value)}>
          <Text style={[styles.segText, {color: o.value === value ? c.text : c.textDim}, o.value === value && styles.segTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// -------------------------------------------------------------------- Sheet

export function Sheet({
  visible,
  onClose,
  title,
  children,
  heightPct = 0.62,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  heightPct?: number;
}) {
  const c = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    Animated.timing(anim, {toValue: visible ? 1 : 0, duration: reduce ? 80 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [visible, anim, reduce]);
  if (!visible) {
    return null;
  }
  const translateY = anim.interpolate({inputRange: [0, 1], outputRange: reduce ? [0, 0] : [600, 0]});
  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.sheetScrim, {backgroundColor: c.scrim, opacity: anim}]}>
        <Pressable style={{flex: 1}} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.sheetKb}>
        <Animated.View style={[styles.sheetBody, {backgroundColor: c.surface, transform: [{translateY}], maxHeight: `${Math.round(heightPct * 100)}%` as any}]}>
          <View style={[styles.sheetHandle, {backgroundColor: c.borderStrong}]} />
          <View style={styles.sheetHead}>
            <Text style={[styles.sheetTitle, {color: c.text}]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.sheetClose, {color: c.textDim}]}>✕</Text>
            </Pressable>
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------- Full modal

export function FullModal({visible, onClose, title, subtitle, children}: {visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode}) {
  const c = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    Animated.timing(anim, {toValue: visible ? 1 : 0, duration: reduce ? 80 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true}).start();
  }, [visible, anim, reduce]);
  if (!visible) {
    return null;
  }
  return (
    <Modal visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.fullModal, {backgroundColor: c.bg}]}>
        <Animated.View style={{flex: 1, opacity: anim, transform: [{translateY: anim.interpolate({inputRange: [0, 1], outputRange: [24, 0]})}]}}>
          <View style={styles.fullModalHead}>
            <View style={{flex: 1}}>
              <Text style={[styles.fmTitle, {color: c.text}]}>{title}</Text>
              {subtitle ? <Text style={[styles.fmSub, {color: c.textDim}]}>{subtitle}</Text> : null}
            </View>
            <IconButton glyph="✕" onPress={onClose} label="close" />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

// -------------------------------------------------------------------- Toast

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

let pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
let toastSeq = 1;

/** Global toast — call from anywhere: showToast('Saved', 'success'). */
export function showToast(text: string, tone: ToastTone = 'success') {
  pushToast?.({text, tone});
}

export function ToastHost() {
  const c = useTheme();
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = t => {
      const id = toastSeq++;
      setItems(prev => [...prev.slice(-2), {id, ...t}]);
      setTimeout(() => setItems(prev => prev.filter(i => i.id !== id)), 2400);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <View pointerEvents="none" style={styles.toastHost}>
      {items.map(i => (
        <ToastCard key={i.id} item={i} toneColor={i.tone === 'success' ? c.success : i.tone === 'error' ? c.danger : c.accent} bg={c.surface} fg={c.text} />
      ))}
    </View>
  );
}

function ToastCard({item, toneColor, bg, fg}: {item: ToastItem; toneColor: string; bg: string; fg: string}) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      anim.setValue(1);
      return;
    }
    Animated.spring(anim, {toValue: 1, useNativeDriver: true, bounciness: 8, speed: 20}).start();
    return () => {};
  }, [anim, reduce]);
  return (
    <Animated.View style={[styles.toast, {backgroundColor: bg, borderStartColor: toneColor, borderStartWidth: 4, opacity: anim, transform: [{translateY: anim.interpolate({inputRange: [0, 1], outputRange: [16, 0]})}]}]}>
      <Text style={{color: fg, fontWeight: '600', flex: 1}} numberOfLines={2}>
        {item.text}
      </Text>
      <Text style={{color: toneColor, fontWeight: '800'}}>{item.tone === 'error' ? '!' : '✓'}</Text>
    </Animated.View>
  );
}

// ------------------------------------------------------------- confirm dialog

/** Destructive-action confirmation (project delete, mask apply, …). */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = useTheme();
  const reduce = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {toValue: visible ? 1 : 0, duration: reduce ? 60 : 160, useNativeDriver: true}).start();
  }, [visible, anim, reduce]);
  if (!visible) {
    return null;
  }
  return (
    <Modal transparent visible={visible} onRequestClose={onCancel} animationType="none" statusBarTranslucent>
      <Animated.View style={[styles.confirmScrim, {backgroundColor: c.scrim, opacity: anim}]}>
        <View
          style={[styles.confirmCard, {backgroundColor: c.surface, borderColor: c.border}]}
          accessible={true}
          accessibilityRole="alert"
          accessibilityLabel={`${title}. ${message ?? ''}`}>
          <Text style={[styles.confirmTitle, {color: c.text}]}>{title}</Text>
          {message ? <Text style={[styles.confirmMsg, {color: c.textDim}]}>{message}</Text> : null}
          <View style={styles.confirmActions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              style={[styles.confirmBtn, {borderColor: c.border, backgroundColor: c.surface2}]}>
              <Text style={[styles.confirmBtnText, {color: c.text}]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={[styles.confirmBtn, {backgroundColor: danger ? c.danger : c.accent, borderColor: 'transparent'}]}>
              <Text style={[styles.confirmBtnText, {color: c.onAccent}]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

// --------------------------------------------------------------------- Misc

export function EmptyState({glyph, title, hint}: {glyph: string; title: string; hint?: string}) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyGlyph, {color: c.textFaint}]}>{glyph}</Text>
      <Text style={[styles.emptyTitle, {color: c.textDim}]}>{title}</Text>
      {hint ? <Text style={[styles.emptyHint, {color: c.textFaint}]}>{hint}</Text> : null}
    </View>
  );
}

export function FadeInView({children, delay = 0, style}: {children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle>}) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    Animated.timing(anim, {toValue: 1, duration: reduce ? 0 : 280, delay: reduce ? 0 : delay, easing: Easing.out(Easing.ease), useNativeDriver: true}).start();
  }, [anim, delay, reduce]);
  return (
    <Animated.View style={[style, {opacity: anim, transform: [{translateY: anim.interpolate({inputRange: [0, 1], outputRange: reduce ? [0, 0] : [10, 0]})}]}]}>
      {children}
    </Animated.View>
  );
}

/** Top bar used by every screen: back + title + trailing actions. */
export function TopBar({
  title,
  onBack,
  actions,
  subtitle,
}: {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  subtitle?: string;
}) {
  const c = useTheme();
  return (
    <View style={[styles.topBar, {borderColor: c.border}]}>
      {onBack ? (
        <IconButton glyph="‹" onPress={onBack} label="back" />
      ) : (
        <View style={{width: 8}} />
      )}
      <View style={{flex: 1, marginHorizontal: 10}}>
        <Text style={[styles.topBarTitle, {color: c.text}]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.topBarSub, {color: c.textDim}]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.topBarActions}>{actions}</View>
    </View>
  );
}

// ------------------------------------------------------------------ helpers

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const c = useTheme();
  return useMemo(() => StyleSheet.create(factory(c)), [c, factory]);
}

const styles = StyleSheet.create({
  primaryBtn: {borderRadius: 13, alignItems: 'center', paddingVertical: 13, paddingHorizontal: 18},
  primaryBtnText: {fontWeight: '800', fontSize: 15},
  ghostBtn: {paddingVertical: 8, paddingHorizontal: 10},
  ghostBtnText: {fontWeight: '700', fontSize: 14},
  iconBtn: {alignItems: 'center', justifyContent: 'center'},
  chip: {paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1},
  chipSmall: {paddingHorizontal: 10, paddingVertical: 5},
  chipText: {fontSize: 12.5, fontWeight: '700'},
  badge: {borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start'},
  badgeText: {fontSize: 10.5, fontWeight: '800'},
  card: {borderRadius: 14, borderWidth: 1, padding: 14},
  sectionRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4},
  sectionLabel: {fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase'},
  divider: {height: 1, opacity: 0.7},
  sliderRow: {gap: 2},
  sliderHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  sliderLabel: {fontSize: 12.5, fontWeight: '700'},
  sliderValue: {fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums']},
  switchRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6},
  switchLabel: {fontSize: 14, fontWeight: '600'},
  input: {borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5},
  inputMultiline: {minHeight: 88, textAlignVertical: 'top'},
  searchWrap: {flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, gap: 8},
  searchIcon: {fontSize: 18, fontWeight: '800'},
  searchInput: {flex: 1, paddingVertical: 10, fontSize: 14.5},
  searchClear: {fontSize: 14, padding: 4},
  segmented: {flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3},
  segIndicator: {position: 'absolute', top: 3, bottom: 3, start: 3, borderRadius: 9, elevation: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: {width: 0, height: 2}},
  segOption: {flex: 1, paddingVertical: 8, alignItems: 'center', zIndex: 1},
  segText: {fontSize: 13, fontWeight: '700'},
  segTextOn: {},
  sheetKb: {flex: 1, justifyContent: 'flex-end'},
  sheetScrim: {...StyleSheet.absoluteFillObject},
  sheetBody: {borderTopStartRadius: 22, borderTopEndRadius: 22, paddingHorizontal: 18, paddingBottom: 24, paddingTop: 10},
  sheetHandle: {width: 40, height: 4.5, borderRadius: 3, alignSelf: 'center', marginBottom: 10},
  sheetHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12},
  sheetTitle: {fontSize: 18, fontWeight: '800'},
  sheetClose: {fontSize: 16, padding: 6},
  fullModal: {flex: 1},
  fullModalHead: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 52, paddingBottom: 10, gap: 8},
  fmTitle: {fontSize: 22, fontWeight: '800'},
  fmSub: {fontSize: 12.5, marginTop: 2},
  toastHost: {position: 'absolute', bottom: 90, start: 16, end: 16, gap: 8, alignItems: 'stretch', zIndex: 999},
  toast: {borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: {width: 0, height: 4}},
  empty: {alignItems: 'center', padding: 28, gap: 8},
  confirmScrim: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 28},
  confirmCard: {borderRadius: 18, borderWidth: 1, padding: 20, gap: 10, width: '100%', maxWidth: 420, elevation: 16, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: {width: 0, height: 8}},
  confirmTitle: {fontSize: 16.5, fontWeight: '800'},
  confirmMsg: {fontSize: 13.5, lineHeight: 20},
  confirmActions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6},
  confirmBtn: {borderRadius: 11, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 18, minWidth: 96, alignItems: 'center'},
  confirmBtnText: {fontWeight: '800', fontSize: 14},
  emptyGlyph: {fontSize: 40},
  emptyTitle: {fontWeight: '700', fontSize: 14.5, textAlign: 'center'},
  emptyHint: {fontSize: 12.5, textAlign: 'center'},
  topBar: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1},
  topBarTitle: {fontSize: 17, fontWeight: '800'},
  topBarSub: {fontSize: 11.5, marginTop: 1},
  topBarActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  chipScroller: {gap: 8, paddingVertical: 2},
});

/** Horizontal chip scroller (used for categories everywhere). */
export function ChipScroller({children}: {children: React.ReactNode}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroller}>
      {children}
    </ScrollView>
  );
}

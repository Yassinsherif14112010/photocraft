/**
 * CanvasStage — the infinite workspace. Renders the real engine composite
 * (`renderThumbnail`) inside a transform stage with:
 *   - one-finger pan, two-finger pinch zoom + rotate
 *   - double-tap to cycle fit / 200%, floating zoom controls (+ − fit)
 *   - tap-to-select via the engine's real hit-test (`layer.pickAt`)
 *   - active-layer bounds overlay with handles (real `doc.inspect` bounds)
 *   - center guides, thirds, and a configurable safe-area overlay
 * The stage transforms are visual-only, so the engine never re-renders for
 * navigation — panning and zooming stay at full frame rate.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useTheme} from '../theme';
import {pickLayerAt, setActiveLayer, useEditor} from '../core/DocumentStore';

interface Props {
  showCenterGuides: boolean;
  showThirds: boolean;
  showSafeArea: boolean;
  safeAreaPct: number;
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
  rot: number; // radians
}

const MAX_SIDE = 1024;

export function CanvasStage({showCenterGuides, showThirds, showSafeArea, safeAreaPct}: Props) {
  const c = useTheme();
  const st = useEditor();
  const [stage, setStage] = useState({w: 0, h: 0});
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [thumb, setThumb] = useState<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState('100%');

  // ---- transform state (view = committed truth, Animated mirrors render) ----
  const view = useRef<ViewTransform>({scale: 1, tx: 0, ty: 0, rot: 0}).current;
  const aScale = useRef(new Animated.Value(1)).current;
  const aTx = useRef(new Animated.Value(0)).current;
  const aTy = useRef(new Animated.Value(0)).current;
  const aRot = useRef(new Animated.Value(0)).current;
  const commit = useCallback(() => {
    aScale.setValue(view.scale);
    aTx.setValue(view.tx);
    aTy.setValue(view.ty);
    aRot.setValue(view.rot);
    setZoomLabel(`${Math.round(view.scale * 100)}%`);
  }, [aScale, aTx, aTy, aRot, view]);

  // ---- document fit (mirror in a ref for stable gesture closures) ----------
  const fit = useMemo(() => {
    if (!st.doc || stage.w === 0 || stage.h === 0) {
      return {scale: 0, w: 0, h: 0};
    }
    const pad = 28;
    const k = Math.min((stage.w - pad) / st.doc.width, (stage.h - pad) / st.doc.height);
    return {scale: k, w: Math.max(1, st.doc.width * k), h: Math.max(1, st.doc.height * k)};
  }, [st.doc, stage.w, stage.h]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  const fitToScreen = useCallback(() => {
    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    view.rot = 0;
    commit();
  }, [commit, view]);

  const setZoom = useCallback(
    (target: number) => {
      view.scale = Math.min(8, Math.max(0.1, target));
      commit();
    },
    [commit, view],
  );

  // ---- live rendering of the real composite (debounced) --------------------
  useEffect(() => {
    if (!st.sessionId) {
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const data = await renderThumb(st.sessionId!, MAX_SIDE, st.canvasVersion);
        if (alive) {
          setThumb(data);
        }
      } catch {
        /* first frame before the first command is expected to be empty */
      }
    }, 140);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [st.sessionId, st.canvasVersion]);

  // ---- tap-to-select through the inverse view transform ---------------------
  const handleTap = useCallback(
    (px: number, py: number) => {
      const f = fitRef.current;
      const sg = stageRef.current;
      if (!st.doc || f.scale === 0) {
        return;
      }
      const rx = px - sg.w / 2;
      const ry = py - sg.h / 2;
      const cos = Math.cos(-view.rot);
      const sin = Math.sin(-view.rot);
      const rrx = rx * cos - ry * sin;
      const rry = rx * sin + ry * cos;
      const ix = rrx / view.scale - view.tx + f.w / 2;
      const iy = rry / view.scale - view.ty + f.h / 2;
      const cx = ix / f.scale;
      const cy = iy / f.scale;
      if (cx < 0 || cy < 0 || cx > st.doc.width || cy > st.doc.height) {
        return;
      }
      pickLayerAt(cx, cy)
        .then(id => {
          if (id != null) {
            setActiveLayer(id);
          }
        })
        .catch(() => {});
    },
    [st.doc, view],
  );

  // ---- gestures ------------------------------------------------------------
  const gesture = useRef({
    startTx: 0,
    startTy: 0,
    startScale: 1,
    startDist: 0,
    startAngle: 0,
    startRot: 0,
    moved: false,
    lastTap: 0,
    tapX: 0,
    tapY: 0,
  }).current;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.numberActiveTouches > 1 || Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: e => {
        gesture.startTx = view.tx;
        gesture.startTy = view.ty;
        gesture.moved = false;
        gesture.startScale = view.scale;
        const now = Date.now();
        if (now - gesture.lastTap < 280) {
          // double-tap: cycle fit ↔ 200%
          if (view.scale > 1.2) {
            fitToScreen();
          } else {
            setZoom(2);
          }
          gesture.lastTap = 0;
          gesture.moved = true; // consume: no select on double-tap
        } else {
          gesture.lastTap = now;
          gesture.tapX = e.nativeEvent.locationX;
          gesture.tapY = e.nativeEvent.locationY;
        }
      },
      onPanResponderMove: (_e, g) => {
        if (g.numberActiveTouches >= 2) {
          gesture.moved = true;
          const touches: Array<{pageX: number; pageY: number}> = [];
          // PanResponder exposes touches through the synthetic event.
          const ev = _e as unknown as {nativeEvent: {touches: Array<{pageX: number; pageY: number}>}};
          for (const tt of ev.nativeEvent.touches) {
            touches.push(tt);
          }
          if (touches.length >= 2) {
            const [t1, t2] = [touches[0], touches[1]];
            const dist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
            const angle = Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX);
            if (gesture.startDist === 0) {
              gesture.startDist = dist || 1;
              gesture.startAngle = angle;
              gesture.startRot = view.rot;
              gesture.startScale = view.scale;
            }
            view.scale = Math.min(8, Math.max(0.1, (gesture.startScale * dist) / gesture.startDist));
            view.rot = gesture.startRot + (angle - gesture.startAngle);
            aScale.setValue(view.scale);
            aRot.setValue(view.rot);
            setZoomLabel(`${Math.round(view.scale * 100)}%`);
          }
        } else if (g.numberActiveTouches === 1) {
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            gesture.moved = true;
          }
          view.tx = gesture.startTx + g.dx;
          view.ty = gesture.startTy + g.dy;
          aTx.setValue(view.tx);
          aTy.setValue(view.ty);
        }
      },
      onPanResponderRelease: () => {
        gesture.startDist = 0;
        if (!gesture.moved && gesture.lastTap) {
          handleTap(gesture.tapX, gesture.tapY);
        }
      },
    }),
  ).current;

  // ---- overlays ------------------------------------------------------------
  const active = st.layers.find(l => l.id === st.activeLayerId);
  const selBox = useMemo(() => {
    if (!active?.bounds || fit.scale === 0) {
      return null;
    }
    const b = active.bounds;
    return {
      left: b.x * fit.scale,
      top: b.y * fit.scale,
      width: b.w * fit.scale,
      height: b.h * fit.scale,
    };
  }, [active, fit.scale]);

  const safeInset = `${Math.max(2, Math.round(safeAreaPct))}%` as const;

  return (
    <View
      style={[styles.stage, {backgroundColor: c.checker}]}
      onLayout={e => setStage({w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}
      {...responder.panHandlers}>
      {st.doc && fit.w > 0 && (
        <Animated.View
          style={[
            styles.transform,
            {transform: [{translateX: aTx}, {translateY: aTy}, {scale: aScale}, {rotate: aRot}]},
          ]}>
          <View style={[styles.docSpace, {width: fit.w, height: fit.h}]}>
            {thumb ? (
              <Image source={{uri: thumb}} style={styles.img} resizeMode="stretch" />
            ) : (
              <View style={[styles.imgPlaceholder, {borderColor: c.border}]}>
                <Text style={{color: c.textFaint, fontSize: 12}}>…</Text>
              </View>
            )}

            {showSafeArea && (
              <View style={[styles.safeArea, {margin: safeInset, borderColor: c.accent2}]} pointerEvents="none" />
            )}
            {showThirds && <ThirdsOverlay color={c.textFaint} />}
            {showCenterGuides && (
              <>
                <View style={[styles.centerV, {backgroundColor: c.accent}]} pointerEvents="none" />
                <View style={[styles.centerH, {backgroundColor: c.accent}]} pointerEvents="none" />
              </>
            )}
            {selBox && (
              <View
                pointerEvents="none"
                style={[styles.selBox, selBox, {borderColor: c.accent}]}>
                <View style={[styles.selHandle, {backgroundColor: c.accent, start: -5, top: -5}]} />
                <View style={[styles.selHandle, {backgroundColor: c.accent, end: -5, top: -5}]} />
                <View style={[styles.selHandle, {backgroundColor: c.accent, start: -5, bottom: -5}]} />
                <View style={[styles.selHandle, {backgroundColor: c.accent, end: -5, bottom: -5}]} />
              </View>
            )}
          </View>
        </Animated.View>
      )}

      {/* floating zoom controls */}
      <View style={[styles.zoomDock, {backgroundColor: c.surface, borderColor: c.border}]}>
        <GlyphBtn glyph="＋" onPress={() => setZoom(view.scale * 1.25)} color={c.text} />
        <GlyphBtn glyph="−" onPress={() => setZoom(view.scale / 1.25)} color={c.text} />
        <Pressable onPress={fitToScreen} hitSlop={6}>
          <Text style={{color: c.accent2, fontSize: 12, fontWeight: '800', minWidth: 46, textAlign: 'center', fontVariant: ['tabular-nums']}}>
            {zoomLabel}
          </Text>
        </Pressable>
        <GlyphBtn glyph="⌂" onPress={fitToScreen} color={c.text} />
      </View>

      {/* dimensions chip */}
      {st.doc && (
        <View style={[styles.dimChip, {backgroundColor: c.surface}]}>
          <Text style={{color: c.textDim, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums']}}>
            {st.doc.width} × {st.doc.height}
          </Text>
        </View>
      )}
    </View>
  );
}

function GlyphBtn({glyph, onPress, color}: {glyph: string; onPress: () => void; color: string}) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.zoomBtn}>
      <Text style={{color, fontSize: 17, fontWeight: '800'}}>{glyph}</Text>
    </Pressable>
  );
}

function ThirdsOverlay({color}: {color: string}) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {[1, 2].map(i => (
        <View key={`v${i}`} style={[styles.thirdV, {start: `${(i * 100) / 3}%`, backgroundColor: color}]} />
      ))}
      {[1, 2].map(i => (
        <View key={`h${i}`} style={[styles.thirdH, {top: `${(i * 100) / 3}%`, backgroundColor: color}]} />
      ))}
    </View>
  );
}

// Cache is keyed per canvasVersion — every successful mutation bumps it, so
// stale renders can never be shown (mirrors the native pngCache eviction).
const thumbCache = new Map<string, string>();
async function renderThumb(sessionId: number, maxSide: number, gen: number): Promise<string> {
  const key = `${sessionId}:${maxSide}:${gen}`;
  const cached = thumbCache.get(key);
  if (cached) {
    thumbCache.delete(key);
    thumbCache.set(key, cached);
    return cached;
  }
  const {Engine} = await import('../native/PhotoCraftEngine');
  const data = await Engine.renderThumbnail(sessionId, maxSide);
  thumbCache.set(key, data);
  if (thumbCache.size > 4) {
    const first = thumbCache.keys().next().value;
    if (first) {
      thumbCache.delete(first);
    }
  }
  return data;
}

const styles = StyleSheet.create({
  stage: {flex: 1, overflow: 'hidden'},
  transform: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  docSpace: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 10},
    elevation: 12,
  },
  img: {width: '100%', height: '100%'},
  imgPlaceholder: {flex: 1, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center'},
  safeArea: {flex: 1, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 6},
  centerV: {position: 'absolute', width: 1, top: 0, bottom: 0, start: '50%', opacity: 0.6},
  centerH: {position: 'absolute', height: 1, start: 0, end: 0, top: '50%', opacity: 0.6},
  thirdV: {position: 'absolute', width: 1, top: 0, bottom: 0, opacity: 0.28},
  thirdH: {position: 'absolute', height: 1, start: 0, end: 0, opacity: 0.28},
  selBox: {position: 'absolute', borderWidth: 1.5},
  selHandle: {position: 'absolute', width: 10, height: 10, borderRadius: 2.5},
  zoomDock: {
    position: 'absolute',
    end: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
  },
  zoomBtn: {width: 34, height: 34, alignItems: 'center', justifyContent: 'center'},
  dimChip: {
    position: 'absolute',
    start: 12,
    bottom: 14,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: {width: 0, height: 2},
  },
});

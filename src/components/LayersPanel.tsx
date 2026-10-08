/**
 * LayersPanel — Photoshop-grade layer experience over the real engine tree:
 *   - engine-rendered thumbnails (`layer.quickExportAsPng` per layer, cached)
 *   - eye / lock toggles, inline rename, color tags, search + filters
 *   - drag reorder (long-press + drop above/below/into groups) via
 *     the engine's real `layer.moveTo {position: above|below|into}`
 *   - swipe left = delete, swipe right = duplicate
 *   - multi-select with group/ungroup/duplicate/delete/visibility batch
 *   - blend mode + opacity/fill for the active layer
 *   - layer manager sheet: arrange, merge down/visible, flatten
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {Palette, useTheme} from '../theme';
import {t} from '../i18n';
import {
  getState,
  runCommand,
  setLayerLock,
  setActiveLayer,
  useEditor,
} from '../core/DocumentStore';
import {History} from '../core/HistoryManager';
import type {LayerSummary} from '../core/types';
import {BLEND_MODES} from '../core/types';
import {Badge, Chip, EmptyState, IconButton, Sheet, showToast} from './ui';

const KEY_TAGS = 'pc.layers.colorTags';
const KEY_EXPANDED = 'pc.layers.expanded';
const TAG_COLORS = ['#EF4444', '#F59E0B', '#10B981', '#22D3EE', '#3B82F6', '#A855F7'];

type Filter = 'all' | 'visible' | 'locked' | 'text' | 'image' | 'group';

export function LayersPanel() {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tags, setTags] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [multi, setMulti] = useState<number[] | null>(null);
  const [manager, setManager] = useState(false);
  const [blendOpen, setBlendOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY_TAGS).then(v => v && setTags(JSON.parse(v)));
    AsyncStorage.getItem(KEY_EXPANDED).then(v => v && setExpanded(JSON.parse(v)));
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = {...prev, [id]: prev[id] === undefined ? false : !prev[id]};
      AsyncStorage.setItem(KEY_EXPANDED, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const cycleTag = useCallback((id: number) => {
    setTags(prev => {
      const cur = prev[id] ?? -1;
      const next = {...prev};
      if (cur >= TAG_COLORS.length - 1) {
        delete next[id];
      } else {
        next[id] = cur + 1;
      }
      AsyncStorage.setItem(KEY_TAGS, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const visibleLayers = useMemo(() => {
    const match = (l: LayerSummary): boolean => {
      if (query && !l.name.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      switch (filter) {
        case 'visible':
          return l.visible;
        case 'locked':
          return !!st.locks[l.id];
        case 'text':
          return l.kind.toLowerCase().includes('text');
        case 'image':
          return !l.kind.toLowerCase().includes('text') && l.kind !== 'group';
        case 'group':
          return l.kind === 'group';
        default:
          return true;
      }
    };
    const walk = (list: LayerSummary[]): LayerSummary[] => {
      const out: LayerSummary[] = [];
      for (const l of list) {
        if (l.children?.length) {
          const kids = walk(l.children);
          if (match(l) || kids.length) {
            out.push({...l, children: kids});
          }
        } else if (match(l)) {
          out.push(l);
        }
      }
      return out;
    };
    return walk(st.layers);
  }, [st.layers, st.locks, query, filter]);

  const active = st.layers.find(l => l.id === st.activeLayerId);

  const flat = useMemo(() => {
    const out: LayerSummary[] = [];
    const walk = (list: LayerSummary[]) => {
      for (const l of list) {
        out.push(l);
        if (l.children && expanded[l.id] !== false) {
          walk(l.children);
        }
      }
    };
    walk(visibleLayers);
    return out;
  }, [visibleLayers, expanded]);

  const duplicate = async (l: LayerSummary) => {
    await runCommand('layer.duplicate', {id: l.id});
    History.push(s.editor.duplicate);
  };

  const remove = async (l: LayerSummary) => {
    await runCommand('layer.delete', {layer: l.id});
    History.push(s.editor.delete);
  };

  const groupSelected = async () => {
    if (!multi || multi.length === 0) {
      return;
    }
    for (const id of multi) {
      await runCommand('layer.select', {layer: id, mode: 'add'});
    }
    await runCommand('layer.groupLayers', {});
    History.push(s.editor.group);
    setMulti(null);
    showToast(s.editor.group);
  };

  const batchVisible = async (on: boolean) => {
    if (!multi) {
      return;
    }
    for (const id of multi) {
      await runCommand('layer.setProps', {layer: id, visible: on});
    }
    History.push(s.editor.layers);
  };

  const batchDelete = async () => {
    if (!multi) {
      return;
    }
    for (const id of multi) {
      await runCommand('layer.delete', {layer: id});
    }
    History.push(s.editor.delete);
    setMulti(null);
  };

  const batchDuplicate = async () => {
    if (!multi) {
      return;
    }
    for (const id of multi) {
      await runCommand('layer.duplicate', {id});
    }
    History.push(s.editor.duplicate);
    setMulti(null);
  };

  const moveLayer = async (layerId: number, targetId: number, position: 'above' | 'below' | 'into') => {
    await runCommand('layer.moveTo', {layer: layerId, target: targetId, position});
    History.push(s.layersPanel.reorderHint);
  };

  return (
    <View style={{flex: 1}}>
      {/* search + filters */}
      <View style={styles.filters}>
        <TextInput
          style={[styles.search, {backgroundColor: c.surface2, color: c.text, borderColor: c.border}]}
          value={query}
          onChangeText={setQuery}
          placeholder={s.layersPanel.search}
          placeholderTextColor={c.textFaint}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 6}}>
          {(
            [
              ['all', s.common.all],
              ['visible', s.layersPanel.filterVisible],
              ['locked', s.layersPanel.filterLocked],
              ['text', s.layersPanel.filterText],
              ['image', s.layersPanel.filterImage],
              ['group', s.layersPanel.filterGroup],
            ] as Array<[Filter, string]>
          ).map(([f, label]) => (
            <Chip key={f} label={label} small active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      {/* header actions */}
      <View style={styles.headRow}>
        <Pressable
          style={[styles.headBtn, {backgroundColor: c.surface2, borderColor: c.border}]}
          onPress={() => setMulti(prev => (prev ? null : []))}>
          <Text style={{color: multi ? c.accent : c.textDim, fontSize: 12, fontWeight: '700'}}>
            {multi ? `${multi.length} ${s.layersPanel.selectedCount}` : s.layersPanel.multiSelect}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.headBtn, {backgroundColor: c.surface2, borderColor: c.border}]}
          onPress={() => {
            runCommand('layer.new.layer', {}).then(() => History.push(s.editor.addLayer));
          }}>
          <Text style={{color: c.text, fontSize: 12, fontWeight: '700'}}>+ {s.editor.addLayer}</Text>
        </Pressable>
        <Pressable
          style={[styles.headBtn, {backgroundColor: c.surface2, borderColor: c.border}]}
          onPress={() => {
            runCommand('layer.groupLayers', {}).then(() => History.push(s.editor.group));
          }}>
          <Text style={{color: c.text, fontSize: 12, fontWeight: '700'}}>📁 {s.editor.group}</Text>
        </Pressable>
        <IconButton glyph="☰" size={32} onPress={() => setManager(true)} label={s.layersPanel.manager} />
      </View>

      {/* multi-select action bar */}
      {multi && (
        <View style={[styles.multiBar, {backgroundColor: c.surface, borderColor: c.border}]}>
          <IconButton glyph="⧉" size={34} onPress={batchDuplicate} label={s.editor.duplicate} />
          <IconButton glyph="👁" size={34} onPress={() => batchVisible(true)} label={s.editor.layers} />
          <IconButton glyph="🚫" size={34} onPress={() => batchVisible(false)} label={s.editor.layers} />
          <IconButton glyph="📁" size={34} onPress={groupSelected} label={s.editor.group} />
          <IconButton glyph="🗑" size={34} danger onPress={batchDelete} label={s.editor.delete} />
          <Pressable onPress={() => setMulti(null)} hitSlop={8}>
            <Text style={{color: c.accent2, fontWeight: '700', fontSize: 12}}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* the tree */}
      <ScrollView style={{flex: 1}} contentContainerStyle={{paddingBottom: 8}}>
        {flat.map(l => (
          <LayerRow
            key={l.id}
            layer={l}
            depth={depthOf(l.id, visibleLayers)}
            active={l.id === st.activeLayerId}
            checked={multi?.includes(l.id) ?? null}
            locked={!!st.locks[l.id]}
            tagColor={tags[l.id] != null ? TAG_COLORS[tags[l.id]] : null}
            expanded={l.children ? expanded[l.id] !== false : undefined}
            canvasVersion={st.canvasVersion}
            onToggleExpand={() => toggleExpand(l.id)}
            onCycleTag={() => cycleTag(l.id)}
            onMultiToggle={() =>
              setMulti(prev => {
                const cur = prev ?? [];
                return cur.includes(l.id) ? cur.filter(i => i !== l.id) : [...cur, l.id];
              })
            }
            onSelect={() => setActiveLayer(l.id)}
            onToggleVisible={() => {
              runCommand('layer.setProps', {layer: l.id, visible: !l.visible}).then(() =>
                History.push(s.editor.layers),
              );
            }}
            onToggleLock={() => setLayerLock(l.id, !st.locks[l.id])}
            onRename={name => {
              runCommand('layer.renameLayer', {layer: l.id, name}).then(() => History.push(s.common.rename));
            }}
            onDuplicate={() => duplicate(l)}
            onDelete={() => remove(l)}
            onDrop={(target, position) => moveLayer(l.id, target, position)}
            flatRows={flat}
          />
        ))}
        {flat.length === 0 && <EmptyState glyph="🗂" title={s.editor.emptyLayers} />}
      </ScrollView>

      {/* active-layer quick strip */}
      {active && !multi && (
        <View style={[styles.quick, {borderTopColor: c.border}]}>
          <Pressable onPress={() => setBlendOpen(true)} style={[styles.blendBtn, {backgroundColor: c.surface2, borderColor: c.border}]}>
            <Text style={{color: c.text, fontSize: 12, fontWeight: '700'}} numberOfLines={1}>
              {active.blendLabel}
            </Text>
            <Text style={{color: c.textFaint, fontSize: 10}}>▼</Text>
          </Pressable>
          <View style={{flex: 1}}>
            <Slider
              minimumValue={0}
              maximumValue={100}
              value={active.opacity * 100}
              onSlidingComplete={v => {
                runCommand('layer.setProps', {layer: active.id, opacity: v / 100}).then(() =>
                  History.push(`${s.editor.opacity} ${Math.round(v)}%`),
                );
              }}
              minimumTrackTintColor={c.accent}
              maximumTrackTintColor={c.surface3}
              thumbTintColor={c.accent}
            />
          </View>
          <Text style={{color: c.textDim, fontSize: 11, fontWeight: '700', width: 36, textAlign: 'center'}}>
            {Math.round(active.opacity * 100)}%
          </Text>
        </View>
      )}

      {/* blend mode picker */}
      <Sheet visible={blendOpen} onClose={() => setBlendOpen(false)} title={s.editor.blendMode} heightPct={0.6}>
        <ScrollView contentContainerStyle={{gap: 6, paddingBottom: 12}}>
          {BLEND_MODES.map(b => (
            <Pressable
              key={b}
              style={[styles.blendRow, {backgroundColor: active?.blend === b ? c.accentSoft : c.surface2}]}
              onPress={() => {
                if (active) {
                  runCommand('layer.setProps', {layer: active.id, blend: b}).then(() => History.push(`${s.editor.blendMode}: ${b}`));
                }
                setBlendOpen(false);
              }}>
              <Text style={{color: active?.blend === b ? c.accent : c.text, fontWeight: '600', fontSize: 13.5}}>
                {b === 'PassThrough' ? 'Pass Through' : b.replace(/([a-z])([A-Z])/g, '$1 $2')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>

      {/* layer manager */}
      <Sheet visible={manager} onClose={() => setManager(false)} title={s.layersPanel.manager} heightPct={0.55}>
        <LayerManager onClose={() => setManager(false)} />
      </Sheet>
    </View>
  );
}

function depthOf(id: number, tree: LayerSummary[], d = 0): number {
  for (const l of tree) {
    if (l.id === id) {
      return d;
    }
    if (l.children) {
      const found = depthOf(id, l.children, d + 1);
      if (found >= 0) {
        return found;
      }
    }
  }
  return -1;
}

// ------------------------------------------------------------------ row

function LayerRow(props: {
  layer: LayerSummary;
  depth: number;
  active: boolean;
  checked: boolean | null;
  locked: boolean;
  tagColor: string | null;
  expanded: boolean | undefined;
  canvasVersion: number;
  flatRows: LayerSummary[];
  onToggleExpand: () => void;
  onCycleTag: () => void;
  onMultiToggle: () => void;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDrop: (targetId: number, position: 'above' | 'below' | 'into') => void;
}) {
  const c = useTheme();
  const s = t();
  const {layer, depth} = props;
  const [renaming, setRenaming] = useState('');
  const [editing, setEditing] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const rowRef = useRef<View>(null);
  const [rowY, setRowY] = useState(0);
  const [rowH, setRowH] = useState(0);
  const dragY = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const dropHintRef = useRef<'above' | 'below' | 'into' | null>(null);
  const [dropHint, setDropHintState] = useState<'above' | 'below' | 'into' | null>(null);
  const setDropHint = (h: 'above' | 'below' | 'into' | null) => {
    dropHintRef.current = h;
    setDropHintState(h);
  };
  const draggingRef = useRef(false);
  const setDraggingState = (v: boolean) => {
    draggingRef.current = v;
    setDragging(v);
  };
  const swipeX = useRef(new Animated.Value(0)).current;
  const [removed, setRemoved] = useState(false);

  // engine-rendered thumbnail (cached per canvasVersion)
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const url = await renderLayerThumb(layer.id, props.canvasVersion);
        if (alive && url) {
          setThumb(url);
        }
      } catch {
        /* groups/adjustments may not render — icon fallback */
      }
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [layer.id, props.canvasVersion]);

  // swipe: left → delete, right → duplicate
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 18 && Math.abs(g.dy) < 12,
      onPanResponderMove: (_e, g) => swipeX.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -90) {
          Animated.timing(swipeX, {toValue: -400, duration: 160, useNativeDriver: true}).start(() => {
            setRemoved(true);
            props.onDelete();
          });
        } else if (g.dx > 90) {
          Animated.spring(swipeX, {toValue: 0, useNativeDriver: true, bounciness: 6}).start();
          props.onDuplicate();
        } else {
          Animated.spring(swipeX, {toValue: 0, useNativeDriver: true, bounciness: 6}).start();
        }
      },
    }),
  ).current;

  // drag reorder (long-press to lift, drop above/below/into) — handlers attach
  // only while dragging, so they always see fresh row geometry.
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2 || Math.abs(g.dx) > 2,
      onPanResponderMove: (_e, g) => {
        dragY.setValue(g.dy);
        const absY = rowY + rowH / 2 + g.dy;
        let hint: 'above' | 'below' | 'into' | null = null;
        for (const row of props.flatRows) {
          if (row.id === layer.id) {
            continue;
          }
          const el = rowYCache.get(row.id);
          if (el && absY > el.y && absY < el.y + el.h) {
            hint = row.kind === 'group' ? 'into' : absY < el.y + el.h / 2 ? 'above' : 'below';
            break;
          }
        }
        setDropHint(hint);
      },
      onPanResponderRelease: () => {
        setDraggingState(false);
        dragY.setValue(0);
        const hint = dropHintRef.current;
        if (hint) {
          const absY = rowY + rowH / 2;
          let targetId = 0;
          for (const row of props.flatRows) {
            if (row.id === layer.id) {
              continue;
            }
            const el = rowYCache.get(row.id);
            if (el && absY > el.y && absY < el.y + el.h) {
              targetId = row.id;
              break;
            }
          }
          if (targetId) {
            props.onDrop(targetId, hint);
          }
        }
        setDropHint(null);
      },
    }),
  ).current;

  useEffect(() => {
    rowYCache.set(layer.id, {y: rowY, h: rowH});
  }, [layer.id, rowY, rowH]);

  const longPress = () => {
    if (props.checked !== null) {
      props.onMultiToggle();
      return;
    }
    setDraggingState(true);
  };

  if (removed) {
    return null;
  }

  const kindGlyph = layer.kind === 'group' ? '📁' : layer.kind.toLowerCase().includes('text') ? 'T' : layer.kind.toLowerCase().includes('adjust') ? '◐' : '🖼';

  return (
    <Animated.View
      ref={rowRef}
      style={[
        styles.rowWrap,
        {transform: [{translateY: dragging ? dragY : 0}, {translateX: swipeX}]},
        dragging && {zIndex: 10, elevation: 8},
      ]}>
      {/* drop indicator */}
      {dragging && dropHint === 'above' && <View style={[styles.dropLine, {backgroundColor: c.accent}]} />}
      <View
        onLayout={e => {
          setRowY(e.nativeEvent.layout.y);
          setRowH(e.nativeEvent.layout.height);
        }}
        style={[
          styles.item,
          {
            backgroundColor: props.active ? c.accentSoft : c.surface,
            borderColor: dropHint === 'into' ? c.accent : props.active ? c.accent : c.border,
            borderWidth: dropHint === 'into' ? 2 : 1,
            marginStart: depth * 16,
          },
        ]}>
        {dragging && <View {...drag.panHandlers} style={StyleSheet.absoluteFill} />}
        <View {...swipe.panHandlers} style={{flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8}}>
          {/* multi-select check / long-press area handled by main press */}
          {props.checked !== null && (
            <Pressable onPress={props.onMultiToggle} hitSlop={6}>
              <View style={[styles.checkbox, {borderColor: c.accent, backgroundColor: props.checked ? c.accent : 'transparent'}]}>
                {props.checked ? <Text style={{color: c.onAccent, fontSize: 11, fontWeight: '900'}}>✓</Text> : null}
              </View>
            </Pressable>
          )}

          {/* visibility */}
          <Pressable onPress={props.onToggleVisible} hitSlop={8}>
            <Text style={{color: layer.visible ? c.text : c.textFaint, fontSize: 13, width: 20, textAlign: 'center'}}>
              {layer.visible ? '👁' : '—'}
            </Text>
          </Pressable>

          {/* thumbnail */}
          <Pressable
            onPress={() => (props.checked !== null ? props.onMultiToggle() : props.onSelect())}
            onLongPress={longPress}
            delayLongPress={380}
            style={[styles.thumb, {backgroundColor: c.checker, borderColor: c.border}]}>
            {thumb ? (
              <Animated.Image source={{uri: thumb}} style={styles.thumbImg} resizeMode="contain" />
            ) : (
              <Text style={{color: c.accent2, fontSize: 13, fontWeight: '800'}}>{kindGlyph}</Text>
            )}
          </Pressable>

          {/* name + meta */}
          <Pressable
            style={{flex: 1}}
            onPress={() => (props.checked !== null ? props.onMultiToggle() : props.onSelect())}
            onLongPress={longPress}
            delayLongPress={380}>
            {editing ? (
              <TextInput
                autoFocus
                style={[styles.renameInput, {color: c.text, borderColor: c.accent, backgroundColor: c.surface2}]}
                value={renaming}
                onChangeText={setRenaming}
                placeholder={s.layersPanel.renameHint}
                placeholderTextColor={c.textFaint}
                onSubmitEditing={() => {
                  if (renaming.trim()) {
                    props.onRename(renaming.trim());
                  }
                  setEditing(false);
                }}
                onBlur={() => setEditing(false)}
                onLayout={() => setRenaming(layer.name)}
              />
            ) : (
              <>
                <Text style={[styles.name, {color: c.text}]} numberOfLines={1}>
                  {layer.children?.length ? (
                    <Text onPress={props.onToggleExpand} style={{color: c.accent2}}>
                      {props.expanded ? '▾ ' : '▸ '}
                    </Text>
                  ) : null}
                  {layer.name}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, {color: c.textDim}]} numberOfLines={1}>
                    {layer.blend} · {Math.round(layer.opacity * 100)}%
                  </Text>
                  {layer.hasMask && <Text style={{color: c.accent2, fontSize: 10}}> ⛨</Text>}
                  {layer.clipped && <Text style={{color: c.warn, fontSize: 10}}> ↳</Text>}
                  {props.locked && <Text style={{color: c.warn, fontSize: 10}}> 🔒</Text>}
                </View>
              </>
            )}
          </Pressable>

          {/* color tag + lock + menu */}
          <Pressable onPress={props.onCycleTag} hitSlop={6}>
            <View style={[styles.tagDot, {backgroundColor: props.tagColor ?? c.surface3}]} />
          </Pressable>
          <Pressable onPress={props.onToggleLock} hitSlop={6}>
            <Text style={{fontSize: 12, color: props.locked ? c.warn : c.textFaint}}>{props.locked ? '🔒' : '🔓'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setEditing(true);
              setRenaming(layer.name);
            }}
            hitSlop={6}>
            <Text style={{fontSize: 12, color: c.textFaint}}>✎</Text>
          </Pressable>
        </View>

        {/* swipe action backgrounds */}
        <View pointerEvents="none" style={styles.swipeHint}>
          <Text style={{color: c.danger, fontSize: 16}}>🗑</Text>
          <Text style={{color: c.success, fontSize: 16}}>⧉</Text>
        </View>
      </View>
      {dragging && dropHint === 'below' && <View style={[styles.dropLine, {backgroundColor: c.accent}]} />}
    </Animated.View>
  );
}

// ---------------------------------------------------------------- manager

function LayerManager({onClose}: {onClose: () => void}) {
  const c = useTheme();
  const s = t();
  const st = useEditor();
  const active = st.layers.find(l => l.id === st.activeLayerId);

  const go = async (cmd: string, params: object = {}, label?: string) => {
    try {
      await runCommand(cmd, params);
      History.push(label ?? cmd);
      showToast(label ?? cmd);
    } catch (e: any) {
      showToast(String(e?.message ?? e), 'error');
    }
  };

  return (
    <View style={{gap: 8, paddingBottom: 10}}>
      <View style={styles.managerGrid}>
        <ManagerBtn label={s.editor.bringFront} glyph="⤒" onPress={() => go('layer.arrange.bringToFront', {}, s.editor.bringFront)} c={c} />
        <ManagerBtn label={s.editor.sendBack} glyph="⤓" onPress={() => go('layer.arrange.sendToBack', {}, s.editor.sendBack)} c={c} />
        <ManagerBtn label={s.layersPanel.mergeDown} glyph="⤥" onPress={() => go('layer.mergeDown', {}, s.layersPanel.mergeDown)} c={c} />
        <ManagerBtn label={s.layersPanel.mergeVisible} glyph="⤡" onPress={() => go('layer.mergeVisible', {}, s.layersPanel.mergeVisible)} c={c} />
        <ManagerBtn label={s.editor.group} glyph="📁" onPress={() => go('layer.groupLayers', {}, s.editor.group)} c={c} />
        <ManagerBtn label={s.editor.ungroup} glyph="📂" onPress={() => go('layer.ungroupLayers', {}, s.editor.ungroup)} c={c} />
        <ManagerBtn label={s.editor.duplicate} glyph="⧉" onPress={() => active && go('layer.duplicate', {id: active.id}, s.editor.duplicate)} c={c} />
        <ManagerBtn label={s.editor.delete} glyph="🗑" danger onPress={() => active && go('layer.delete', {layer: active.id}, s.editor.delete)} c={c} />
      </View>
      <Badge text={s.layersPanel.reorderHint} />
      <Pressable onPress={onClose} style={{padding: 10, alignItems: 'center'}}>
        <Text style={{color: c.accent2, fontWeight: '700'}}>{s.common.close}</Text>
      </Pressable>
    </View>
  );
}

function ManagerBtn({label, glyph, onPress, c, danger}: {label: string; glyph: string; onPress: () => void; c: Palette; danger?: boolean}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.managerBtn, {backgroundColor: c.surface2, borderColor: c.border}]}
      android_ripple={{color: c.border}}>
      <Text style={{fontSize: 18, color: danger ? c.danger : c.text}}>{glyph}</Text>
      <Text style={{color: danger ? c.danger : c.textDim, fontSize: 10.5, fontWeight: '700', textAlign: 'center'}} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

// -------------------------------------------------------- thumbnail cache

const thumbMem = new Map<string, string>();
const rowYCache = new Map<number, {y: number; h: number}>();
let thumbQueue: Promise<unknown> = Promise.resolve();

const TMP_DIR = '/data/data/com.photocraft.mobile/files/tmp';

/**
 * Real per-layer thumbnails: the engine exports the layer's own composite
 * (`layer.quickExportAsPng {layer, path}`), the native module reads it back
 * as base64, and the result is cached per (layer, canvasVersion). Work is
 * serialized through a promise queue so the panel never floods the engine.
 */
async function renderLayerThumb(layerId: number, version: number): Promise<string | null> {
  const key = `${layerId}:${version}`;
  const hit = thumbMem.get(key);
  if (hit) {
    return hit;
  }
  const run = (thumbQueue = thumbQueue.then(async () => {
    if (thumbMem.has(key)) {
      return;
    }
    try {
      const {Engine} = await import('../native/PhotoCraftEngine');
      const sessionId = getState().sessionId;
      if (sessionId == null) {
        return;
      }
      const path = `${TMP_DIR}/thumb-${layerId}.png`;
      const reply = await Engine.execute(sessionId, 'layer.quickExportAsPng', {layer: layerId, path});
      if (reply.error) {
        return;
      }
      const b64 = await Engine.readFileBase64(path);
      const url = `data:image/png;base64,${b64}`;
      thumbMem.set(key, url);
      if (thumbMem.size > 140) {
        const oldest = thumbMem.keys().next().value;
        if (oldest) {
          thumbMem.delete(oldest);
        }
      }
    } catch {
      /* groups/adjustment-only stacks may refuse — icon fallback shows */
    }
  }));
  await run;
  return thumbMem.get(key) ?? null;
}

const styles = StyleSheet.create({
  filters: {gap: 8, marginBottom: 8},
  search: {borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13.5},
  headRow: {flexDirection: 'row', gap: 6, marginBottom: 8, alignItems: 'center'},
  headBtn: {borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7},
  multiBar: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  checkbox: {width: 20, height: 20, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  rowWrap: {},
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 11,
    padding: 8,
    marginBottom: 5,
    gap: 6,
    overflow: 'hidden',
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: {width: '100%', height: '100%'},
  name: {fontWeight: '700', fontSize: 13},
  metaRow: {flexDirection: 'row', alignItems: 'center'},
  meta: {fontSize: 10.5},
  renameInput: {borderWidth: 1.5, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13},
  tagDot: {width: 12, height: 12, borderRadius: 6},
  swipeHint: {...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, opacity: 0.35},
  dropLine: {height: 2.5, borderRadius: 2, marginHorizontal: 8},
  quick: {flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, paddingTop: 8, marginTop: 4},
  blendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 150,
  },
  blendRow: {borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10},
  managerGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  managerBtn: {width: '23%', borderRadius: 11, borderWidth: 1, padding: 8, alignItems: 'center', gap: 4},
});

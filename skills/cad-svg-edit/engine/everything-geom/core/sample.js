/**
 * A small sample drawing (a mounting plate with a detail of its slot) that
 * shows layers, linetypes, arcs, polylines, hatching, text, dimensions,
 * leaders and blocks. Built in code so it always matches the data model.
 */
import { Drawing } from './drawing.js';
import { STANDARD_LINETYPES } from './linetypes.js';
import { defaultLayer, COLOR_BYLAYER, LW_BYLAYER } from './schema.js';

const T = Math.tan(Math.PI / 8);

export function sampleDrawing() {
  const d = new Drawing();
  for (const lt of STANDARD_LINETYPES) d.linetypes.set(lt.name, { ...lt });
  const layer = (name, color, linetype = 'Continuous', lineweight = -3, description = '') => d.setTable('layers', name, { ...defaultLayer(name), color, linetype, lineweight, description });
  const P = (lay) => ({ layer: lay, color: COLOR_BYLAYER, linetype: 'ByLayer', lineweight: LW_BYLAYER, ltscale: 1 });
  d.transaction('Sample', () => {
    layer('Outline', 7, 'Continuous', 50, 'Visible edges');
    layer('Hidden', 8, 'Hidden', 18, 'Hidden edges');
    layer('Center', 1, 'Center', 13, 'Center lines');
    layer('Hatch', 252, 'Continuous', 13, 'Section hatching');
    layer('Dimensions', 4, 'Continuous', 13, 'Dimensions and notes');
    layer('Title', 7, 'Continuous', 35, 'Title block');
    d.setHeader({ clayer: 'Outline', textHeight: 3.5, ltscale: 0.5 });

    // Plate outline with rounded corners (radius 8).
    const r = 8;
    d.add({
      ...P('Outline'),
      type: 'polyline',
      pts: [r, 0, 0, 160 - r, 0, T, 160, r, 0, 160, 90 - r, T, 160 - r, 90, 0, r, 90, T, 0, 90 - r, 0, 0, r, T],
      closed: true,
      width: 0,
    });
    // Mounting holes with center marks, as a block.
    d.setBlock('Hole', {
      name: 'Hole',
      bx: 0,
      by: 0,
      description: 'Mounting hole with center lines',
      entities: [
        { ...P('Outline'), layer: '0', color: 0, linetype: 'ByBlock', lineweight: -2, id: 1, type: 'circle', cx: 0, cy: 0, r: 5 },
        { ...P('Center'), id: 2, type: 'line', x1: -8, y1: 0, x2: 8, y2: 0 },
        { ...P('Center'), id: 3, type: 'line', x1: 0, y1: -8, x2: 0, y2: 8 },
      ],
    });
    for (const [x, y] of [
      [15, 15],
      [145, 15],
      [145, 75],
      [15, 75],
    ])
      d.add({ ...P('Outline'), type: 'insert', name: 'Hole', x, y, sx: 1, sy: 1, rot: 0 });
    // Central slot.
    d.add({ ...P('Outline'), type: 'polyline', pts: [60, 35, 0, 100, 35, 1, 100, 55, 0, 60, 55, 1], closed: true, width: 0 });
    // Bore with a hidden counterbore.
    d.add({ ...P('Outline'), type: 'circle', cx: 80, cy: 45, r: 4 });
    d.add({ ...P('Hidden'), type: 'circle', cx: 30, cy: 45, r: 9 });
    d.add({ ...P('Outline'), type: 'circle', cx: 30, cy: 45, r: 6 });
    d.add({ ...P('Outline'), type: 'circle', cx: 130, cy: 45, r: 6 });
    d.add({ ...P('Hidden'), type: 'circle', cx: 130, cy: 45, r: 9 });
    // Center lines.
    d.add({ ...P('Center'), type: 'line', x1: -8, y1: 45, x2: 168, y2: 45 });
    d.add({ ...P('Center'), type: 'line', x1: 80, y1: -8, x2: 80, y2: 98 });

    // Section view to the right, hatched.
    const sx = 200;
    d.add({ ...P('Outline'), type: 'polyline', pts: [sx, 0, 0, sx + 12, 0, 0, sx + 12, 90, 0, sx, 90, 0], closed: true, width: 0 });
    d.add({
      ...P('Hatch'),
      type: 'hatch',
      loops: [[sx, 0, 0, sx + 12, 0, 0, sx + 12, 35, 0, sx, 35, 0], [sx, 55, 0, sx + 12, 55, 0, sx + 12, 90, 0, sx, 90, 0]],
      pattern: 'LINES',
      scale: 0.6,
      angle: 0,
    });
    d.add({ ...P('Outline'), type: 'line', x1: sx, y1: 35, x2: sx + 12, y2: 35 });
    d.add({ ...P('Outline'), type: 'line', x1: sx, y1: 55, x2: sx + 12, y2: 55 });
    d.add({ ...P('Center'), type: 'line', x1: sx - 6, y1: 45, x2: sx + 18, y2: 45 });

    // Dimensions.
    const dim = (f) => ({ ...P('Dimensions'), type: 'dimension', style: 'Standard', text: '', rot: 0, x3: 0, y3: 0, x4: 0, y4: 0, ...f });
    d.add(dim({ dimType: 'linear', x1: 0, y1: 0, x2: 160, y2: 0, lx: 80, ly: -16 }));
    d.add(dim({ dimType: 'linear', x1: 160, y1: 0, x2: 160, y2: 90, lx: 176, ly: 45, rot: Math.PI / 2 }));
    d.add(dim({ dimType: 'linear', x1: 15, y1: 75, x2: 145, y2: 75, lx: 80, ly: 104 }));
    d.add(dim({ dimType: 'linear', x1: 60, y1: 35, x2: 100, y2: 35, lx: 80, ly: 26 }));
    d.add(dim({ dimType: 'diameter', x1: 30, y1: 45, x2: 30 + 6 * Math.cos(2.3), y2: 45 + 6 * Math.sin(2.3), lx: 14, ly: 62 }));
    d.add(dim({ dimType: 'radius', x1: 80, y1: 45, x2: 84, y2: 45, lx: 94, ly: 30 }));
    d.add(dim({ dimType: 'linear', x1: sx, y1: 0, x2: sx + 12, y2: 0, lx: sx + 6, ly: -16 }));
    d.add({ ...P('Dimensions'), type: 'leader', pts: [126, 50, 116, 74, 106, 74], text: '2x counterbore 18 deep 3', h: 2.5, style: 'Standard' });

    // Notes and a simple title block.
    d.add({ ...P('Dimensions'), type: 'text', x: sx + 6, y: 100, h: 3.5, rot: 0, value: 'SECTION A-A', style: 'Standard', halign: 'center', valign: 'baseline', widthFactor: 1, oblique: 0 });
    d.add({ ...P('Title'), type: 'polyline', pts: [-20, -40, 0, 240, -40, 0, 240, 120, 0, -20, 120, 0], closed: true, width: 0 });
    d.add({ ...P('Title'), type: 'polyline', pts: [140, -40, 0, 240, -40, 0, 240, -24, 0, 140, -24, 0], closed: true, width: 0 });
    d.add({ ...P('Title'), type: 'text', x: 144, y: -30, h: 3.5, rot: 0, value: 'Mounting plate', style: 'Standard', halign: 'left', valign: 'baseline', widthFactor: 1, oblique: 0 });
    d.add({ ...P('Title'), type: 'text', x: 236, y: -36, h: 2.5, rot: 0, value: 'Scale 1:1   mm', style: 'Standard', halign: 'right', valign: 'baseline', widthFactor: 1, oblique: 0 });
    d.add({
      ...P('Dimensions'),
      type: 'mtext',
      x: -14,
      y: -26,
      h: 2.5,
      rot: 0,
      value: 'Notes:\n1. Break all sharp edges.\n2. Material: aluminium plate, 12 thick.',
      style: 'Standard',
      width: 120,
      attach: 'tl',
      lineSpacing: 1,
    });
  });
  d.undoStack = [];
  d.markSaved();
  return d;
}

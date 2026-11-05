/**
 * Text and dimension styles.
 */

export function defaultTextStyle(name = 'Standard') {
  return { name, font: 'sans', height: 0, widthFactor: 1, oblique: 0 };
}

/**
 * Dimension style. Sizes are in drawing units before `scale` is applied.
 *   arrowType: 'closed' | 'open' | 'tick' | 'dot' | 'none'
 *   textPlacement: 'above' (text sits above the dimension line) | 'centered'
 *   textAlign: 'aligned' (text follows the dimension line) | 'horizontal'
 */
export function defaultDimStyle(name = 'Standard') {
  return {
    name,
    textHeight: 2.5,
    textStyle: 'Standard',
    textGap: 0.625,
    textPlacement: 'above',
    textAlign: 'aligned',
    arrowType: 'closed',
    arrowSize: 2.5,
    extOffset: 0.625,
    extExtend: 1.25,
    centerMark: 2.5,
    precision: 2,
    trailingZeros: false,
    prefix: '',
    suffix: '',
    scale: 1,
    // Colors of the parts; 0 = ByBlock (follows the dimension's own color).
    lineColor: 0,
    textColor: 0,
  };
}

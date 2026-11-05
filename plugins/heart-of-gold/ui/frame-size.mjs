/** Total inline border-box budget, including chrome and safe-area padding.
 * Pass the merged host context: partial notifications do not erase prior bounds.
 * Never derive this value from the iframe viewport or its measured content.
 */
export function inlineFrameHeight(hostContext = {}) {
  const dimensions = hostContext?.containerDimensions;
  const limits = [dimensions?.height, dimensions?.maxHeight]
    .filter(value => Number.isFinite(value) && value > 0);
  return Math.min(420, ...limits);
}

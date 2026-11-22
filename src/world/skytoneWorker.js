// Builds skytone's lookup table off the main thread (a second or two of arithmetic).
import { buildTable } from './skytoneMath.js';

self.onmessage = ({ data }) => {
  const lut = buildTable(data);
  self.postMessage(lut, [lut.buffer]);
};

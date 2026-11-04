// Primerjava z edge-tts 7.3.1 (Python generate_sec_ms_gec_v2). node src/edge-gec.test.mjs
import { secMsGecV2 } from './edge-gec.js';

const ref = {
  1700000000: '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2',
  1793750000: '5228BF7921D73780-93EDF0B1223BFBE30FEA05BE7C810C87EEF8B4419659C48C67F8C9F2F9E4956D',
  1800000123.5: '99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654',
};
let ok = 0;
for (const [t, z] of Object.entries(ref)) {
  const g = secMsGecV2(Number(t));
  console.log(g === z ? 'OK    ' : 'NAPAKA', t, g);
  if (g === z) ok++;
}
process.exitCode = ok === Object.keys(ref).length ? 0 : 1;

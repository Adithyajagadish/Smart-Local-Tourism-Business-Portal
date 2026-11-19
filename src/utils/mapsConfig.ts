export const GOOGLE_MAPS_API_KEY: string =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
  (typeof __GOOGLE_MAPS_API_KEY__ !== 'undefined' ? __GOOGLE_MAPS_API_KEY__ : '') ||
  '';

export const GOOGLE_MAP_ID = 'DEMO_MAP_ID';

export const GMP_ATTRIBUTION_IDS = ['gmp_mcp_codeassist_v1_aistudio'];

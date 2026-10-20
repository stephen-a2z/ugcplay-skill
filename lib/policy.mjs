// Public upload protocol limits. Keep in sync when the server contract changes.
export const MAX_FILES = 200;
export const MAX_SINGLE_FILE = 50 * 1024 * 1024;
export const MAX_TOTAL_UNZIPPED = 100 * 1024 * 1024;
export const GUEST_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ALLOWED_EXT = new Set('html htm js mjs css json webmanifest md txt png jpg jpeg gif svg webp ico wasm pck mp3 m4a ogg wav woff2 ttf dat glb gltf mp4 webm'.split(' '));

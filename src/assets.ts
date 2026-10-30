import { defineAssets } from '@iwsdk/core';
import { createRoom } from './scene-assets/room.scene-asset.js';

// Everything else on the desk is procedural and spawned at runtime, so the
// cold start downloads no models, textures or audio.
export default defineAssets({
  room: createRoom(),
});

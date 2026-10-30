import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ClaySystem } from './core/clay.js';
import { DeskSystem } from './core/desk.js';
import { HandSystem } from './core/hands.js';
import { ManipulateSystem } from './core/manipulate.js';
import { unlockAudio } from './feedback/sfx.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(DeskSystem, { priority: 1 })
    .registerSystem(ManipulateSystem, { priority: 10 })
    .registerSystem(ClaySystem, { priority: 20 });

  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  }
});

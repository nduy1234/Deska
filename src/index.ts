import { Vector3, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ClaySystem } from './core/clay.js';
import { desk, DeskSystem } from './core/desk.js';
import { hands, HandSystem } from './core/hands.js';
import { manipulation, ManipulateSystem } from './core/manipulate.js';
import { unlockAudio } from './feedback/sfx.js';
import { AgentSystem } from './agent/agent.js';
import { DEFAULT_BEHAVIORS } from './blocks/templates.js';
import { GrowthSystem } from './persist/growth.js';
import { PersistSystem } from './persist/persist.js';
import { deskState } from './persist/state.js';
import type { Archetype } from './sculpt/recognizer.js';
import { spawnTool, ToolSystem } from './tools/tools.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(DeskSystem, { priority: 1 })
    .registerSystem(ManipulateSystem, { priority: 10 })
    .registerSystem(ToolSystem, { priority: 15 })
    .registerSystem(AgentSystem, { priority: 22 })
    .registerSystem(GrowthSystem, { priority: 25 })
    .registerSystem(PersistSystem, { priority: 30 })
    .registerSystem(ClaySystem, { priority: 20 });

  // Accessibility: ?onehand=1 lets a single pinch sculpt against the desk.
  manipulation.oneHanded = new URLSearchParams(location.search).has('onehand');

  if (import.meta.env.DEV) {
    // Emulator test hook (scripts/emu.sh emu_eval); stripped from production.
    (window as unknown as Record<string, unknown>).__deska = {
      world,
      desk,
      hands,
      deskState,
      agent: world.getSystem(AgentSystem),
      spawn: (a: Archetype, x: number, z: number) =>
        spawnTool(world, a, DEFAULT_BEHAVIORS[a], new Vector3(x, 0, z)).index,
    };
  }

  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  }
});

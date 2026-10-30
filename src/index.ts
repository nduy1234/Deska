import { SessionMode, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ClaySystem } from './core/clay.js';
import { desk, DeskSystem } from './core/desk.js';
import { hands, HandSystem } from './core/hands.js';
import { PassthroughSystem } from './core/passthrough.js';
import { manipulation, ManipulateSystem } from './core/manipulate.js';
import { unlockAudio } from './feedback/sfx.js';
import { AgentSystem } from './agent/agent.js';
import { DEFAULT_BEHAVIORS } from './blocks/templates.js';
import { OnboardingSystem } from './onboarding/onboarding.js';
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
    .registerSystem(PassthroughSystem, { priority: 2 })
    .registerSystem(ManipulateSystem, { priority: 10 })
    .registerSystem(ToolSystem, { priority: 15 })
    .registerSystem(AgentSystem, { priority: 22 })
    .registerSystem(GrowthSystem, { priority: 25 })
    .registerSystem(OnboardingSystem, { priority: 26 })
    .registerSystem(PersistSystem, { priority: 30 })
    .registerSystem(ClaySystem, { priority: 20 });

  // 2D entry card: an obvious "Enter Deska" on headsets, a hint elsewhere.
  const card = document.getElementById('enter');
  const button = document.getElementById('enter-button');
  const hint = document.getElementById('enter-hint');
  void navigator.xr?.isSessionSupported('immersive-vr').then((ok) => {
    if (ok && button) button.hidden = false;
    else if (hint) hint.textContent = 'Open this page in Meta Quest Browser to step in. Desktop shows a preview.';
  });
  button?.addEventListener('click', () => {
    unlockAudio();
    world.launchXR();
  });
  // Stretch: passthrough mode puts the desk on your real table.
  const mr = document.getElementById('enter-mr');
  void navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
    if (ok && mr) mr.hidden = false;
  });
  mr?.addEventListener('click', () => {
    unlockAudio();
    world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
  });
  world.visibilityState.subscribe((state) => {
    card?.classList.toggle('gone', state !== VisibilityState.NonImmersive);
  });

  // Quest: steady 72 Hz and foveation for headroom (IWSDK XR optimization guide).
  world.visibilityState.subscribe((state) => {
    if (state === VisibilityState.Visible) {
      void world.session?.updateTargetFrameRate?.(72).catch(() => {});
      world.renderer.xr.setFoveation(1);
    }
  });

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
      onboarding: world.getSystem(OnboardingSystem),
      spawn: (a: Archetype, x: number, z: number) =>
        spawnTool(world, a, DEFAULT_BEHAVIORS[a], new Vector3(x, 0, z)).index,
    };
  }

  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  }
});

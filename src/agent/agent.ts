import {
  Color,
  createSystem,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { SoundName } from '../blocks/schema.js';
import type { TraceEntry } from '../blocks/simulate.js';
import { INTENT_TEMPLATES } from '../blocks/templates.js';
import { createClayMesh } from '../core/clay.js';
import { desk } from '../core/desk.js';
import { deskEvents } from '../core/events.js';
import { hands, SIDES } from '../core/hands.js';
import { Label } from '../feedback/label.js';
import { sfx, unlockAudio } from '../feedback/sfx.js';
import { deformPositions, halfExtents } from '../sculpt/deform.js';
import { ARCHETYPE_SHAPES } from '../sculpt/recognizer.js';
import { spawnTool } from '../tools/tools.js';
import { httpRequest, makeTool, type AgentResult, type AgentStage, type RequestFn } from './pipeline.js';

type State = 'idle' | 'listening' | 'choosing' | 'working' | 'preview';

const ORB_POS = new Vector3(-0.36, 0, -0.17);
const GHOST_SPOTS = [new Vector3(0.0, 0, 0.1), new Vector3(-0.15, 0, 0.12), new Vector3(0.15, 0, 0.05)];
const TOUCH = 0.04;
const STEP = 0.75;

const STAGE_TEXT: Record<AgentStage, string> = {
  thinking: 'Thinking…',
  repairing: 'Fixing a mistake…',
  testing: 'Testing it…',
  fallback: 'Using a recipe I know',
};

const SOUNDS: Record<SoundName, () => void> = {
  chime: sfx.chime,
  tap: sfx.tap,
  lock: sfx.lock,
  sparkle: sfx.sparkle,
  whoosh: sfx.whoosh,
  detent: sfx.detent,
  place: sfx.place,
};

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRec) | null;
}

/**
 * "Make a tool": poke the orb and say what you want (or pick an intent card
 * when speech isn't available). The agent writes block JSON on the server,
 * the client validates and simulates it, and a ghost of the tool plays the
 * simulation on the desk. Pinch the ghost to keep it.
 */
export class AgentSystem extends createSystem({}) {
  private state: State = 'idle';
  private orb!: Mesh;
  private orbMat!: MeshStandardMaterial;
  private orbLabel!: Label;
  private cards: { label: Label; intent: string }[] = [];
  private ghost: Group | null = null;
  private ghostMesh: Mesh | null = null;
  private ghostLabel!: Label;
  private ghostPos = new Vector3();
  private result: AgentResult | null = null;
  private playback: TraceEntry[] = [];
  private playIndex = 0;
  private playTimer = 0;
  private anim = { flip: 0, flipTarget: 0, turn: 0, tilt: 0, pulse: 0 };
  private time = 0;
  private orbInside = false;
  private rec: SpeechRec | null = null;
  private listenTimeout = 0;
  private v = new Vector3();
  request: RequestFn = httpRequest();

  init(): void {
    const g = new Group();
    g.position.copy(ORB_POS);
    const base = new Mesh(
      new CylinderGeometry(0.034, 0.038, 0.012, 24),
      new MeshStandardMaterial({ color: '#8a6a4c', roughness: 0.8 }),
    );
    base.position.y = 0.006;
    this.orbMat = new MeshStandardMaterial({
      color: '#f6e7d2',
      roughness: 0.35,
      emissive: new Color('#ffcf8a'),
      emissiveIntensity: 0.25,
    });
    this.orb = new Mesh(new SphereGeometry(0.026, 24, 16), this.orbMat);
    this.orb.position.y = 0.038;
    g.add(base, this.orb);
    desk.group!.add(g);

    this.orbLabel = new Label(0.12);
    this.orbLabel.sprite.position.set(ORB_POS.x, 0.1, ORB_POS.z);
    this.orbLabel.setPersistent('Make a tool');
    desk.group!.add(this.orbLabel.sprite);
    this.ghostLabel = new Label(0.15);
    desk.group!.add(this.ghostLabel.sprite);
  }

  /** Programmatic entry (dev hook and intent cards). */
  ask(intent: string): void {
    if (this.state === 'working') return;
    this.clearCards();
    this.clearGhost();
    this.state = 'working';
    this.orbLabel.show(`“${intent.slice(0, 40)}”`, 2);
    void makeTool(intent, this.request, (s) => this.orbLabel.setPersistent(STAGE_TEXT[s])).then((r) =>
      this.showGhost(r),
    );
  }

  // ------------------------------------------------------------ input

  private orbTouched(): boolean {
    let touched = false;
    let inside = false;
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked) continue;
      const near = (p: Vector3) => this.localDist(p, ORB_POS, 0.038) < TOUCH;
      if (h.pinchStart && near(h.pinchPoint)) touched = true;
      if (!h.pinching && near(h.indexTip)) inside = true;
    }
    if (inside && !this.orbInside) touched = true;
    this.orbInside = inside;
    return touched;
  }

  private localDist(world: Vector3, local: Vector3, y = 0): number {
    this.v.copy(world);
    desk.group!.worldToLocal(this.v);
    return Math.hypot(this.v.x - local.x, this.v.y - (local.y + y), this.v.z - local.z);
  }

  private onOrb(): void {
    unlockAudio();
    sfx.tap();
    if (this.state === 'listening') {
      this.rec?.stop();
      this.showCards();
      return;
    }
    if (this.state === 'choosing' || this.state === 'preview') {
      this.clearCards();
      this.clearGhost();
      this.toIdle();
      return;
    }
    if (this.state === 'idle') this.listen();
  }

  private listen(): void {
    const Ctor = speechCtor();
    if (!Ctor) {
      this.showCards();
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      let finalText = '';
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText = text;
        }
        this.orbLabel.setPersistent(`“${text.slice(-44)}”`);
      };
      rec.onerror = () => {
        if (this.state === 'listening') this.showCards();
      };
      rec.onend = () => {
        if (this.state !== 'listening') return;
        if (finalText.trim()) this.ask(finalText.trim());
        else this.showCards();
      };
      this.rec = rec;
      rec.start();
      this.state = 'listening';
      this.listenTimeout = 8;
      this.orbLabel.setPersistent('Listening… say what you need');
    } catch {
      this.showCards();
    }
  }

  // ------------------------------------------------------------ intent cards

  private showCards(): void {
    this.clearCards();
    this.state = 'choosing';
    this.orbLabel.setPersistent('Pick one · poke me to close');
    const list = INTENT_TEMPLATES.slice(0, 6);
    list.forEach((t, i) => {
      // Two columns floating over the front of the desk, within easy reach.
      const label = new Label(0.2);
      const col = i % 2;
      const row = Math.floor(i / 2);
      label.sprite.position.set(-0.11 + col * 0.22, 0.13 + row * 0.065, 0.02 - row * 0.02);
      label.setPersistent(t.card);
      desk.group!.add(label.sprite);
      this.cards.push({ label, intent: t.card });
    });
  }

  private clearCards(): void {
    for (const c of this.cards) c.label.dispose();
    this.cards = [];
  }

  private pickedCard(): string | null {
    for (const side of SIDES) {
      const h = hands[side];
      if (!h.tracked) continue;
      for (const c of this.cards) {
        const p = c.label.sprite.position;
        if (h.pinchStart && this.localDist(h.pinchPoint, p) < 0.05) return c.intent;
        if (!h.pinching && this.localDist(h.indexTip, p) < 0.025) return c.intent;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ ghost preview

  private showGhost(r: AgentResult): void {
    this.result = r;
    this.state = 'preview';
    const shape = ARCHETYPE_SHAPES[r.archetype];
    const mesh = createClayMesh(shape.primitive);
    const pos = mesh.geometry.getAttribute('position');
    deformPositions(mesh.geometry.getAttribute('basePosition').array, pos.array as Float32Array, shape.deform);
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.material = new MeshStandardMaterial({
      color: '#7fb6f2',
      roughness: 0.4,
      transparent: true,
      opacity: 0.6,
      emissive: new Color('#4f95e8'),
      emissiveIntensity: 0.45,
      depthWrite: false,
    });
    const g = new Group();
    const hy = halfExtents(shape.deform).y;
    mesh.position.y = hy;
    g.add(mesh);
    this.ghostPos.copy(this.clearestSpot());
    g.position.copy(this.ghostPos);
    desk.group!.add(g);
    this.ghost = g;
    this.ghostMesh = mesh;
    this.ghostLabel.sprite.position.set(this.ghostPos.x, hy * 2 + 0.05, this.ghostPos.z);
    this.anim = { flip: 0, flipTarget: 0, turn: 0, tilt: 0, pulse: 0 };

    // Play the sandbox trace: compress time, keep order.
    this.playback = r.sim.trace.filter((e) => e.kind !== 'timerStop').slice(0, 14);
    this.playIndex = 0;
    this.playTimer = 0.4;
    sfx.sparkle();
    this.orbLabel.setPersistent(r.source === 'template' ? 'Here’s one I know' : 'Here’s your tool');
    this.ghostLabel.show(r.behavior.name, 2);
  }

  private step(e: TraceEntry): void {
    switch (e.kind) {
      case 'event': {
        const [type, value] = e.detail.split(' ');
        if (type === 'flip') this.anim.flipTarget = this.anim.flipTarget ? 0 : Math.PI;
        else if (type === 'turn') this.anim.turn = -Number(value ?? 0) * Math.PI * 1.5;
        else if (type === 'pull') this.anim.tilt = 0.7;
        else this.anim.pulse = 1;
        this.ghostLabel.show(`↻ ${type}`, 0.7);
        break;
      }
      case 'text':
        this.ghostLabel.show(e.detail, 1.4);
        break;
      case 'sound':
        SOUNDS[e.detail as SoundName]?.();
        break;
      case 'dim':
        this.ghostLabel.show(`dims room ${Math.round(Number(e.detail) * 100)}%`, 1.2);
        break;
      case 'timerStart':
        this.ghostLabel.show(`timer ${e.detail.split(':')[1] ?? ''}`, 1.2);
        break;
      case 'timerEnd':
        this.ghostLabel.show('timer done', 1);
        break;
      case 'sort':
        this.ghostLabel.show('sorts notes', 1);
        break;
      case 'color':
        (this.ghostMesh!.material as MeshStandardMaterial).color.set(e.detail);
        break;
    }
  }

  private finishPlayback(): void {
    const r = this.result!;
    const passed = r.sim.checks.filter((c) => c.pass).length;
    const tag = r.source === 'template' ? 'recipe' : r.source === 'repaired' ? 'fixed + tested' : 'tested';
    this.ghostLabel.setPersistent(`✓ ${passed}/${r.sim.checks.length} ${tag} · pinch to keep`);
    this.orbLabel.setPersistent('Poke me to discard');
  }

  private ghostPinched(): boolean {
    if (!this.ghost) return false;
    for (const side of SIDES) {
      const h = hands[side];
      if (h.tracked && h.pinchStart && this.localDist(h.pinchPoint, this.ghostPos, 0.04) < 0.07) return true;
    }
    return false;
  }

  private confirm(): void {
    const r = this.result!;
    const e = spawnTool(this.world, r.archetype, r.behavior, this.ghostPos.clone());
    sfx.lock();
    deskEvents.emit({ type: 'spawned', entity: e });
    deskEvents.emit({ type: 'archetype', entity: e, archetype: r.archetype });
    this.clearGhost();
    this.toIdle();
    this.orbLabel.show(`${r.behavior.name} is yours`, 3);
  }

  private clearGhost(): void {
    if (this.ghost) {
      this.ghostMesh?.geometry.dispose();
      (this.ghostMesh?.material as MeshStandardMaterial | undefined)?.dispose();
      this.ghost.removeFromParent();
    }
    this.ghost = null;
    this.ghostMesh = null;
    this.result = null;
    this.ghostLabel.setPersistent('');
  }

  private toIdle(): void {
    this.state = 'idle';
    this.orbLabel.setPersistent('Make a tool');
  }

  private clearestSpot(): Vector3 {
    let best = GHOST_SPOTS[0];
    let bestD = -1;
    for (const spot of GHOST_SPOTS) {
      let d = Infinity;
      for (const c of desk.group!.children) {
        if (!/^(clay|note)/.test(c.name) || c.position.z < -0.12) continue;
        d = Math.min(d, Math.hypot(c.position.x - spot.x, c.position.z - spot.z));
      }
      if (d > bestD) {
        bestD = d;
        best = spot;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ frame

  update(delta: number): void {
    this.time += delta;
    if (this.orbTouched() && this.state !== 'working') this.onOrb();

    if (this.state === 'listening') {
      this.listenTimeout -= delta;
      if (this.listenTimeout <= 0) this.rec?.stop();
    }
    if (this.state === 'choosing') {
      const intent = this.pickedCard();
      if (intent) {
        sfx.pick();
        this.ask(intent);
      }
    }
    if (this.state === 'preview' && this.ghost) {
      if (this.playIndex < this.playback.length) {
        this.playTimer -= delta;
        if (this.playTimer <= 0) {
          const e = this.playback[this.playIndex++];
          this.step(e);
          this.playTimer = e.kind === 'event' ? STEP : STEP * 0.6;
          if (this.playIndex >= this.playback.length) this.finishPlayback();
        }
      }
      if (this.ghostPinched()) this.confirm();
    }

    // Ghost animation.
    if (this.ghostMesh) {
      const a = this.anim;
      a.flip += (a.flipTarget - a.flip) * Math.min(1, delta * 6);
      a.tilt = Math.max(0, a.tilt - delta * 0.8);
      a.pulse = Math.max(0, a.pulse - delta * 2.5);
      this.ghostMesh.rotation.set(a.flip + a.tilt, a.turn, 0);
      this.ghostMesh.scale.setScalar(1 + a.pulse * 0.12);
      this.ghost!.position.y = 0.004 + Math.sin(this.time * 2) * 0.003;
    }

    // Orb mood per state.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * (this.state === 'working' ? 7 : 3));
    const [hex, base, amp] =
      this.state === 'listening'
        ? ['#8fc4ff', 0.5, 0.4]
        : this.state === 'working'
          ? ['#ffc36b', 0.45, 0.45]
          : this.state === 'preview'
            ? ['#a9e3a0', 0.35, 0.2]
            : ['#ffcf8a', 0.2, 0.1];
    this.orbMat.emissive.set(hex);
    this.orbMat.emissiveIntensity = base + amp * pulse;
    this.orb.scale.setScalar(1 + (this.state === 'listening' ? 0.08 * pulse : 0));

    this.orbLabel.update(delta);
    this.ghostLabel.update(delta);
    for (const c of this.cards) c.label.update(delta);
  }
}

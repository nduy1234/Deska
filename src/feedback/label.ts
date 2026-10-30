import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from '@iwsdk/core';

/**
 * Small spatial label: a camera-facing sprite drawn from a canvas. One draw
 * call each, redrawn only when the text changes. Labels are the only text in
 * Deska and never the primary UI.
 */
const W = 512;
const H = 128;

export class Label {
  readonly sprite: Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: CanvasTexture;
  private text = '';
  private ttl = 0;
  private opacity = 0;
  private persistent = '';

  constructor(widthMeters = 0.14) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, opacity: 0 });
    this.sprite = new Sprite(mat);
    this.sprite.scale.set(widthMeters, (widthMeters * H) / W, 1);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  /** Show text for `seconds`, then fall back to the persistent line (if any). */
  show(text: string, seconds = 3): void {
    this.ttl = seconds;
    this.draw(text, false);
  }

  /** A quiet line shown whenever no transient text is up (e.g. countdown). */
  setPersistent(text: string): void {
    this.persistent = text;
    if (this.ttl <= 0 && text !== this.text) this.draw(text, true);
  }

  update(delta: number): void {
    const mat = this.sprite.material;
    if (this.ttl > 0) {
      this.ttl -= delta;
      if (this.ttl <= 0 && this.persistent) this.draw(this.persistent, true);
    }
    const target = this.ttl > 0 ? 1 : this.persistent ? 0.75 : 0;
    this.opacity += (target - this.opacity) * Math.min(1, delta * 8);
    mat.opacity = this.opacity;
    this.sprite.visible = this.opacity > 0.02;
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }

  private draw(text: string, quiet: boolean): void {
    if (text === this.text) return;
    this.text = text;
    const c = this.ctx;
    c.clearRect(0, 0, W, H);
    c.font = `600 ${quiet ? 54 : 60}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const tw = Math.min(W - 16, c.measureText(text).width + 64);
    const x = (W - tw) / 2;
    c.fillStyle = quiet ? 'rgba(60, 44, 32, 0.7)' : 'rgba(60, 44, 32, 0.85)';
    c.beginPath();
    c.roundRect(x, 14, tw, H - 28, (H - 28) / 2);
    c.fill();
    c.fillStyle = '#fff6ea';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, W / 2, H / 2 + 2, W - 48);
    this.texture.needsUpdate = true;
  }
}

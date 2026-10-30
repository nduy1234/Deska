import {
  CircleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from '@iwsdk/core';

/**
 * Calm study room shell: warm floor, a round rug under the chair and two
 * soft wall panels. Plain standard materials, no textures, so it costs a
 * handful of draw calls and nothing to download.
 */
export function createRoom(): Group {
  const root = new Group();

  const floor = new Mesh(
    new PlaneGeometry(14, 14),
    new MeshStandardMaterial({ color: '#7f6b5b', roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  const rug = new Mesh(
    new CircleGeometry(1.4, 48),
    new MeshStandardMaterial({ color: '#a99582', roughness: 1 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.004, -0.2);
  root.add(rug);

  const wallMaterial = new MeshStandardMaterial({
    color: '#efe3d3',
    roughness: 1,
  });
  const back = new Mesh(new PlaneGeometry(9, 3.2), wallMaterial);
  back.position.set(0, 1.6, -3.2);
  root.add(back);
  const left = new Mesh(new PlaneGeometry(7, 3.2), wallMaterial);
  left.rotation.y = Math.PI / 2;
  left.position.set(-3.6, 1.6, 0);
  root.add(left);

  return root;
}

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Group, MathUtils, SphereGeometry } from "three";
import { Env, canvasTexture, tokenStr } from "./kit";
import type { SceneProps } from "../components";

interface Props { numbers: number[]; bonus: number; runKey: number; }
const GAP = 1.2, REST = 0, START = 5, STAGGER = 0.22;
const K = 70, C = 5; // underdamped spring: small rebound, then settles (no physics engine for 6 spheres)

function decal(n: number, ink: string) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = ink; g.textAlign = "center"; g.font = `900 150px ${tokenStr("--font-display")}`;
    g.fillText(String(n).padStart(2, "0"), 128, 178);
  });
}
const patch = new SphereGeometry(0.505, 32, 24, Math.PI / 2 - 0.62, 1.24, Math.PI / 2 - 0.62, 1.24);
const ball = new SphereGeometry(0.5, 48, 32);

function Ball({ n, i, count, bonus, runKey, reduced, active }: { n: number; i: number; count: number; bonus: boolean; runKey: number; reduced: boolean; active: boolean }) {
  const ref = useRef<Group>(null);
  const st = useRef({ y: START, v: 0, t: 0 });
  const gold = tokenStr("--accent"), cream = tokenStr("--accent-2"), navy = tokenStr("--on-accent");
  const tex = useMemo(() => decal(n, navy), [n, navy]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => { st.current = { y: reduced ? REST : START, v: 0, t: 0 }; }, [runKey, reduced]);
  useFrame((_, dt) => {
    const g = ref.current, s = st.current; if (!g) return;
    dt = Math.min(dt, 1 / 30);
    if (reduced) { s.y = REST; s.v = 0; }
    if (!reduced && active) {
      s.t += dt;
      if (s.t > i * STAGGER) { s.v += (-K * (s.y - REST) - C * s.v) * dt; s.y += s.v * dt; }
    }
    g.visible = reduced || s.t > i * STAGGER;
    g.position.set((i - (count - 1) / 2) * GAP, s.y, 0);
    g.rotation.y = MathUtils.clamp((s.y - REST) * 0.15, 0, 1);
  });
  return (
    <group ref={ref}>
      <mesh geometry={ball}><meshPhysicalMaterial color={bonus ? cream : gold} metalness={0.9} roughness={0.2} clearcoat={1} clearcoatRoughness={0.1} /></mesh>
      <mesh geometry={patch}><meshBasicMaterial map={tex} transparent polygonOffset polygonOffsetFactor={-1} toneMapped={false} /></mesh>
    </group>
  );
}

export default function BallsScene({ numbers, bonus, runKey, active, reduced, ready }: Props & SceneProps) {
  useEffect(() => { ready(); }, [ready]);
  const all = [...numbers, bonus];
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ powerPreference: "high-performance", alpha: true, antialias: true }}
      camera={{ fov: 28, position: [0, 0.5, 6.2] }}
      frameloop={active && !reduced ? "always" : "demand"}
    >
      <Env />
      <directionalLight position={[2, 4, 5]} intensity={1.4} color={tokenStr("--accent")} />
      <group position={[0, -0.4, 0]}>
        {all.map((n, i) => <Ball key={i} n={n} i={i} count={all.length} bonus={i === 5} runKey={runKey} reduced={reduced} active={active} />)}
      </group>
    </Canvas>
  );
}

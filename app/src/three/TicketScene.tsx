import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdditiveBlending, ExtrudeGeometry, Group, MathUtils, Mesh, Shape } from "three";
import { Env, canvasTexture, tokenStr } from "./kit";
import type { SceneProps } from "../components";

interface Props { numbers: number[]; bonus: number; index: number; campaign: number; }
const W = 3.2, H = 2, D = 0.08, R = 0.16;
const SHINE_SECS = 4.5; // same cadence as the CSS `shine` keyframe

function cardShape() {
  const s = new Shape(), x = -W / 2, y = -H / 2;
  s.moveTo(x + R, y); s.lineTo(x + W - R, y); s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + H - R); s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  s.lineTo(x + R, y + H); s.quadraticCurveTo(x, y + H, x, y + H - R);
  s.lineTo(x, y + R); s.quadraticCurveTo(x, y, x + R, y);
  return s;
}

function Card({ numbers, bonus, index, campaign, active, reduced, ready }: Props & SceneProps) {
  const group = useRef<Group>(null);
  const shine = useRef<Mesh>(null);
  const geo = useMemo(() => new ExtrudeGeometry(cardShape(), { depth: D, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 4, curveSegments: 12 }), []);
  const gold = tokenStr("--accent"), navy = tokenStr("--surface"), cream = tokenStr("--text"), display = tokenStr("--font-display");

  const face = useMemo(() => canvasTexture(1024, 640, (g) => {
    g.fillStyle = gold; g.textAlign = "center";
    g.font = `italic 600 64px ${display}`; g.fillText("Cryptoball", 512, 130);
    const all = [...numbers, bonus];
    all.forEach((n, i) => {
      const cx = 112 + i * 160, cy = 340, last = i === 5;
      g.beginPath(); g.arc(cx, cy, 66, 0, Math.PI * 2);
      g.fillStyle = last ? cream : gold; g.fill();
      g.fillStyle = navy; g.font = `900 52px ${display}`; g.fillText(String(n).padStart(2, "0"), cx, cy + 18);
    });
    g.fillStyle = cream; g.globalAlpha = 0.75; g.font = `500 34px "Inter Tight", sans-serif`;
    g.fillText(`Ticket #${index} · Draw #${campaign}`, 512, 540);
  }), [numbers, bonus, index, campaign, gold, navy, cream, display]);

  const sweep = useMemo(() => canvasTexture(256, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
  }), []);

  useEffect(() => { ready(); }, [ready]);
  useEffect(() => () => { geo.dispose(); face.dispose(); sweep.dispose(); }, [geo, face, sweep]);

  useFrame((state, dt) => {
    const g = group.current; if (!g) return;
    if (reduced) { g.rotation.set(0, 0, 0); return; }
    const t = state.clock.elapsedTime, p = state.pointer;
    const idle = Math.sin(t * 0.6) * 0.18;
    g.rotation.y = MathUtils.damp(g.rotation.y, p.x * 0.5 + idle, 6, dt);
    g.rotation.x = MathUtils.damp(g.rotation.x, -p.y * 0.35, 6, dt);
    if (shine.current) shine.current.position.x = -W + ((t % SHINE_SECS) / SHINE_SECS) * W * 2.4;
  });

  const z = D + 0.035;
  return (
    <group ref={group}>
      <mesh geometry={geo} position={[0, 0, -D / 2]}>
        <meshPhysicalMaterial attach="material-0" color={navy} roughness={0.45} metalness={0.2} clearcoat={0.6} />
        <meshStandardMaterial attach="material-1" color={gold} roughness={0.22} metalness={1} />
      </mesh>
      <mesh position={[0, 0, z - D / 2]}>
        <planeGeometry args={[W - 0.2, (W - 0.2) * 0.625]} />
        <meshBasicMaterial map={face} transparent toneMapped={false} />
      </mesh>
      <mesh ref={shine} position={[-W, 0, z - D / 2 + 0.01]} rotation={[0, 0, -0.26]}>
        <planeGeometry args={[0.9, H * 1.4]} />
        <meshBasicMaterial map={sweep} transparent opacity={reduced ? 0 : 0.5} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default function TicketScene(props: Props & SceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ powerPreference: "high-performance", alpha: true, antialias: true }}
      camera={{ fov: 30, position: [0, 0, 7.4] }}
      frameloop={props.active && !props.reduced ? "always" : "demand"}
    >
      <Env />
      <directionalLight position={[2, 3, 4]} intensity={1.6} color={tokenStr("--accent")} />
      <Card {...props} />
    </Canvas>
  );
}

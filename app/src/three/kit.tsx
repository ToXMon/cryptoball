import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, PMREMGenerator, SRGBColorSpace } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** Tokens drive the materials (design report 5a): read the live CSS custom property, no second palette. */
export const tokenStr = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Studio environment map for the gold's specular; one per scene, disposed on unmount. */
export function Env() {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const pm = new PMREMGenerator(gl);
    const rt = pm.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = rt.texture;
    invalidate();
    return () => { scene.environment = null; rt.dispose(); pm.dispose(); };
  }, [gl, scene, invalidate]);
  return null;
}

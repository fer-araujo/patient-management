import { useEffect, useRef, useState } from "react";
import { Eraser, Save } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { SIGNATURE_MAX_BYTES } from "../../../lib/services/prescriberService";

interface SignaturePadProps {
  /** Receives the drawn signature as a PNG, cropped to the ink. */
  onSave: (png: Blob) => Promise<void>;
  disabled?: boolean;
}

const PAD_HEIGHT = 200;
const INK = "#0f172a";
const LINE_WIDTH = 2.5;
const CROP_PADDING = 8;
/** Ink needed before "Guardar firma" is enabled, in CSS pixels. */
const MIN_SIGNATURE_LENGTH = 60;
const MIN_SIGNATURE_SIZE = 40;

const RESIZED_MESSAGE = "La pantalla cambió de tamaño y se borró la firma. Dibújala de nuevo.";

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Point {
  x: number;
  y: number;
}

const toPng = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });

/**
 * A canvas where the doctor draws her signature with a finger or stylus
 * (pointer events, no library). Scrolling is disabled on the pad while
 * drawing; only the first finger draws (a palm or second finger is
 * ignored). When the pad changes size (e.g. the iPad is rotated) the drawing
 * is erased, because the canvas cannot keep it. "Guardar firma" is enabled
 * once there is enough ink for a signature, and hands a PNG cropped to the
 * ink to `onSave`.
 */
export const SignaturePad = ({ onSave, disabled = false }: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const last = useRef<Point | null>(null);
  const bounds = useRef<Bounds | null>(null);
  const strokeLength = useRef(0);
  const scale = useRef(1);
  // CSS width the backing store was sized for.
  const cssWidth = useRef(0);
  const [hasInk, setHasInk] = useState(false);
  const [isLongEnough, setIsLongEnough] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backing store at the screen's pixel density, so the line is sharp; sized
  // again (which erases it) whenever the pad changes width.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setup = () => {
      const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const width = canvas.clientWidth || 600;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(PAD_HEIGHT * ratio);
      scale.current = ratio;
      cssWidth.current = width;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = LINE_WIDTH;
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
    };

    setup();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const width = canvas.clientWidth;
      if (!width || Math.abs(width - cssWidth.current) < 1) return;
      const hadInk = bounds.current !== null;
      setup();
      activePointer.current = null;
      last.current = null;
      bounds.current = null;
      strokeLength.current = 0;
      setHasInk(false);
      setIsLongEnough(false);
      setError(hadInk ? RESIZED_MESSAGE : null);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /** The pointer on the drawing's coordinates, even if the pad was scaled. */
  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sx = rect.width > 0 && cssWidth.current > 0 ? cssWidth.current / rect.width : 1;
    const sy = rect.height > 0 ? PAD_HEIGHT / rect.height : 1;
    return {
      x: ((event.clientX ?? 0) - rect.left) * sx,
      y: ((event.clientY ?? 0) - rect.top) * sy,
    };
  };

  const grow = ({ x, y }: Point) => {
    const b = bounds.current;
    bounds.current = b
      ? {
          minX: Math.min(b.minX, x),
          minY: Math.min(b.minY, y),
          maxX: Math.max(b.maxX, x),
          maxY: Math.max(b.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
    const box = bounds.current;
    const bigEnough =
      strokeLength.current >= MIN_SIGNATURE_LENGTH &&
      Math.max(box.maxX - box.minX, box.maxY - box.minY) >= MIN_SIGNATURE_SIZE;
    setIsLongEnough(bigEnough);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || isSaving) return;
    // A second finger or a resting palm never draws.
    if (!event.isPrimary || activePointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointOf(event);
    activePointer.current = event.pointerId;
    last.current = point;
    grow(point);
    const ctx = event.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, LINE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    setHasInk(true);
    setError(null);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current === null || event.pointerId !== activePointer.current) return;
    if (!last.current) return;
    event.preventDefault();
    const point = pointOf(event);
    const ctx = event.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    strokeLength.current += Math.hypot(point.x - last.current.x, point.y - last.current.y);
    last.current = point;
    grow(point);
  };

  const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== activePointer.current) return;
    activePointer.current = null;
    last.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    activePointer.current = null;
    last.current = null;
    bounds.current = null;
    strokeLength.current = 0;
    setHasInk(false);
    setIsLongEnough(false);
    setError(null);
  };

  /** The ink only, plus a small margin; the whole pad if cropping fails. */
  const croppedCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    const b = bounds.current;
    if (!b) return canvas;
    const ratio = scale.current;
    const pad = CROP_PADDING + LINE_WIDTH;
    const x = Math.max(0, Math.floor((b.minX - pad) * ratio));
    const y = Math.max(0, Math.floor((b.minY - pad) * ratio));
    const w = Math.min(canvas.width - x, Math.ceil((b.maxX - b.minX + pad * 2) * ratio));
    const h = Math.min(canvas.height - y, Math.ceil((b.maxY - b.minY + pad * 2) * ratio));
    if (w <= 0 || h <= 0) return canvas;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return out;
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk || !isLongEnough) return;
    setIsSaving(true);
    setError(null);
    try {
      const png = await toPng(croppedCanvas(canvas));
      if (!png) {
        setError("No se pudo leer la firma. Intenta de nuevo.");
        return;
      }
      if (png.size > SIGNATURE_MAX_BYTES) {
        setError("La firma es demasiado grande. Bórrala y dibújala de nuevo.");
        return;
      }
      await onSave(png);
      clear();
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "No se pudo guardar la firma.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        aria-label="Área para dibujar la firma"
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerLeave={stopDrawing}
        style={{ height: PAD_HEIGHT }}
        className="w-full bg-white border-2 border-dashed border-slate-300 rounded-xl touch-none select-none cursor-crosshair"
      />
      <p className="text-base text-brand-gray">
        {hasInk && !isLongEnough
          ? "Firma muy pequeña: dibújala completa, más grande."
          : "Firme con el dedo o con un lápiz dentro del recuadro."}
      </p>
      {error && (
        <p role="alert" className="text-base font-medium text-rose-600">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={clear}
          disabled={!hasInk || isSaving}
          className="flex-1 min-h-11 py-3.5 rounded-xl cursor-pointer text-base flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Eraser className="w-5 h-5" aria-hidden="true" /> Borrar
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={!hasInk || !isLongEnough || isSaving || disabled}
          className="flex-1 min-h-11 py-3.5 rounded-xl bg-brand-primary hover:bg-brand-dark text-white border-none shadow-md cursor-pointer disabled:opacity-50 font-bold text-base flex items-center justify-center gap-2"
        >
          <Save className="w-5 h-5" aria-hidden="true" />
          {isSaving ? "Guardando..." : "Guardar firma"}
        </Button>
      </div>
    </div>
  );
};

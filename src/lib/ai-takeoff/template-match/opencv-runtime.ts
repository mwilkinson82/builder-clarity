// opencv.js runtime surface (AITAKEOFF6 Task 0).
// The structural slice of opencv.js the matcher actually calls, plus the one
// safe way to wait for the wasm runtime. No opencv import here — the worker
// (browser) and the smoke suite (node, via createRequire) each load the
// module themselves and hand it in, so this file stays pure and portable.

/** The slice of cv.Mat the matcher touches. */
export interface CvMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  ucharPtr(row: number, col: number): Uint8Array;
  delete(): void;
}

export interface CvMatConstructor {
  new (): CvMat;
  new (rows: number, cols: number, type: number): CvMat;
  new (rows: number, cols: number, type: number, scalar: unknown): CvMat;
}

/** The slice of the opencv.js module the matcher calls. */
export interface OpenCvApi {
  CV_8UC1: number;
  CV_8UC4: number;
  COLOR_RGBA2GRAY: number;
  ADAPTIVE_THRESH_MEAN_C: number;
  THRESH_BINARY_INV: number;
  TM_CCOEFF_NORMED: number;
  INTER_AREA: number;
  INTER_LINEAR: number;
  BORDER_CONSTANT: number;
  Mat: CvMatConstructor;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Scalar: new (...values: number[]) => unknown;
  cvtColor(src: CvMat, dst: CvMat, code: number): void;
  resize(
    src: CvMat,
    dst: CvMat,
    dsize: unknown,
    fx: number,
    fy: number,
    interpolation: number,
  ): void;
  adaptiveThreshold(
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    C: number,
  ): void;
  copyMakeBorder(
    src: CvMat,
    dst: CvMat,
    top: number,
    bottom: number,
    left: number,
    right: number,
    borderType: number,
    value: unknown,
  ): void;
  getRotationMatrix2D(center: unknown, angleDeg: number, scale: number): CvMat;
  warpAffine(
    src: CvMat,
    dst: CvMat,
    M: CvMat,
    dsize: unknown,
    flags: number,
    borderMode: number,
    borderValue: unknown,
  ): void;
  matchTemplate(image: CvMat, templ: CvMat, result: CvMat, method: number): void;
}

/** How long the wasm runtime gets to come up before the scan fails loudly. */
export const OPENCV_READY_TIMEOUT_MS = 120_000;

/**
 * Wait for the opencv.js runtime and return it in a WRAPPER object.
 *
 * The wrapper is load-bearing, not style: OLDER emscripten builds export a
 * self-resolving thenable — its `then` calls back with the module itself, so
 * any promise that resolves TO the module re-adopts it forever (a silent
 * 100% CPU spin, reproduced under node during AITAKEOFF6). MODERN builds
 * (the opencv.js 5.x line) export a genuine Promise whose resolution VALUE
 * is the cv module. This handles both: the `then` callback's argument wins
 * when it looks like a cv module, and nothing raw ever flows through
 * promise adoption — callers destructure `{ cv }`.
 */
export function openCvReady(
  cvModule: unknown,
  timeoutMs: number = OPENCV_READY_TIMEOUT_MS,
): Promise<{ cv: OpenCvApi }> {
  return new Promise((resolve, reject) => {
    const moduleRecord = cvModule as Record<string, unknown> | null;
    if (!moduleRecord || typeof moduleRecord !== "object") {
      reject(new Error("opencv.js module failed to load."));
      return;
    }
    let settled = false;
    const settle = (candidate: unknown) => {
      if (settled) return;
      settled = true;
      const record = candidate as Record<string, unknown> | null;
      const cv = record && typeof record === "object" && record.Mat ? record : moduleRecord;
      resolve({ cv: cv as unknown as OpenCvApi });
    };
    if (moduleRecord.Mat) {
      settle(moduleRecord);
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("The symbol matcher took too long to start."));
      }
    }, timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    if (typeof moduleRecord.then === "function") {
      // Callback style only — never `await` the module (see above).
      (moduleRecord.then as (cb: (value: unknown) => void) => void)((value) => {
        clearTimeout(timer);
        settle(value);
      });
      return;
    }
    moduleRecord.onRuntimeInitialized = () => {
      clearTimeout(timer);
      settle(moduleRecord);
    };
  });
}

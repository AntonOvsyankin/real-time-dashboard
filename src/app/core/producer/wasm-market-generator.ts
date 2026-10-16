import { RECORD_STRIDE } from '../models/market-update';
import { errorMessage } from '../utils/error-message';
import { GeneratorLoader, MarketGenerator } from './market-generator';

const EXPECTED_ABI_VERSION = 1;

interface GeneratorExports {
  memory: WebAssembly.Memory;
  gen_abi_version(): number;
  gen_record_stride(): number;
  gen_create(instrumentCount: number, seed: number): number;
  gen_generate(count: number): number;
  gen_buffer_ptr(): number;
  gen_destroy(): void;
}

const REQUIRED_FUNCTIONS = [
  'gen_abi_version',
  'gen_record_stride',
  'gen_create',
  'gen_generate',
  'gen_buffer_ptr',
  'gen_destroy',
] as const;

async function instantiate(res: Response): Promise<WebAssembly.Instance> {
  try {
    try {
      const { instance } = await WebAssembly.instantiateStreaming(res.clone(), {});
      return instance;
    } catch (e) {
      if (!(e instanceof TypeError)) {
        throw e;
      }
      const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
      return instance;
    }
  } catch (e) {
    throw new Error('Failed to instantiate Wasm module: ' + errorMessage(e));
  }
}

function validateExports(exports: WebAssembly.Exports): GeneratorExports {
  const missing: string[] = REQUIRED_FUNCTIONS.filter(
    (name) => typeof exports[name] !== 'function',
  );
  if (!(exports['memory'] instanceof WebAssembly.Memory)) {
    missing.push('memory');
  }
  if (missing.length > 0) {
    throw new Error(`Incompatible Wasm module: missing exports ${missing.join(', ')}`);
  }
  const ex = exports as unknown as GeneratorExports;
  const abi = ex.gen_abi_version();
  if (abi !== EXPECTED_ABI_VERSION) {
    throw new Error(
      `Incompatible Wasm module: ABI version ${abi}, expected ${EXPECTED_ABI_VERSION}`,
    );
  }
  const stride = ex.gen_record_stride();
  if (stride !== RECORD_STRIDE) {
    throw new Error(`Incompatible Wasm module: record stride ${stride}, expected ${RECORD_STRIDE}`);
  }
  return ex;
}

function describeGenerateError(code: number): string {
  switch (code) {
    case -2:
      return 'Invalid batch size';
    case -3:
      return 'Generator is not configured';
    default:
      return `Generator failed with code ${code}`;
  }
}

export const loadWasmMarketGenerator: GeneratorLoader = async (wasmUrl) => {
  if (typeof WebAssembly === 'undefined') {
    throw new Error('WebAssembly is not supported in this browser.');
  }

  let res: Response;
  try {
    res = await fetch(wasmUrl);
  } catch (e) {
    throw new Error('Failed to download Wasm module: ' + errorMessage(e));
  }
  if (!res.ok) {
    throw new Error(`Failed to load Wasm module (HTTP ${res.status}) from ${wasmUrl}`);
  }

  const ex = validateExports((await instantiate(res)).exports);

  const generator: MarketGenerator = {
    configure(instrumentCount: number, seed: number): void {
      const rc = ex.gen_create(instrumentCount, seed >>> 0);
      if (rc < 0) {
        throw new Error(`Invalid instrument count: ${instrumentCount}`);
      }
    },
    generate(count: number): Int32Array {
      const rc = ex.gen_generate(count);
      if (rc < 0) {
        throw new Error(describeGenerateError(rc));
      }
      return new Int32Array(ex.memory.buffer, ex.gen_buffer_ptr(), count * RECORD_STRIDE);
    },
    dispose(): void {
      ex.gen_destroy();
    },
  };
  return generator;
};

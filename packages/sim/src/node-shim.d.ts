// CLI で使う Node.js の API だけの型宣言（@types/node を入れずに済ませるため）
declare module 'node:fs' {
  export function appendFileSync(path: string, data: string): void;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare module 'node:path' {
  export function dirname(path: string): string;
}
declare const process: {
  readonly argv: readonly string[];
  readonly stderr: { write(s: string): void };
  exit(code?: number): never;
};

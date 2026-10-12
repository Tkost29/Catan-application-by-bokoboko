// ワークスペースのパッケージ名を、ビルド済みの JavaScript に対応させる
const MAP = {
  '@bokoboko/engine': '../dist/packages/engine/src/index.js',
  '@bokoboko/ai': '../dist/packages/ai/src/index.js',
};

export async function resolve(specifier, context, next) {
  const target = MAP[specifier];
  return next(target ? new URL(target, import.meta.url).href : specifier, context);
}

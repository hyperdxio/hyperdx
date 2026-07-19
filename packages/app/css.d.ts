// Ambient declarations for plain (non-module) stylesheet side-effect imports,
// e.g. `import '@mantine/core/styles.css'`. Next.js only ships ambient types
// for CSS Modules (`*.module.css`), and TypeScript 6 enforces TS2882 for
// side-effect imports of otherwise-untyped modules, so declare the plain
// stylesheet extensions here. CSS Modules keep their typed declarations from
// Next's `global.d.ts`.
declare module '*.css';
declare module '*.scss';
declare module '*.sass';

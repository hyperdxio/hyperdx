declare module '*.mdx' {
  export default any;
  export const meta: any;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}

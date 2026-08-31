// remark-gfm is ESM-only, which Jest (with transformIgnorePatterns:
// ['/node_modules/']) cannot parse. It's only meaningful when react-markdown
// (also mocked) actually renders markdown, so a noop plugin suffices.
export default function remarkGfm() {}

import { EditorState } from '@codemirror/state';

import {
  languageExtensions,
  queryEditorBaseTheme,
} from '@/components/Explore/queryEditorLanguage';

describe('languageExtensions', () => {
  it('creates an editor state for a non-empty lucene query', () => {
    expect(() =>
      EditorState.create({
        doc: 'level:error AND ServiceName:frontend-proxy',
        extensions: [
          queryEditorBaseTheme,
          ...languageExtensions('lucene', ['Level', 'ServiceName']),
        ],
      }),
    ).not.toThrow();
  });
});

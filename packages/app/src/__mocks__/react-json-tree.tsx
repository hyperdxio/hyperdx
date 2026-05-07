// Mock for react-json-tree ESM module. We could improve this by mocking the actual module if needed.
import { Trans } from 'next-i18next/pages';

const JSONTree = (
  <div data-testid="json-tree">
    <Trans>JSONTree</Trans>
  </div>
);

module.exports = JSONTree;

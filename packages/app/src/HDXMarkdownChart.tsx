import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChartVariable } from '@hyperdx/common-utils/dist/types';
import {
  substituteVariables,
  validateVariableReferencesInTemplate,
} from '@hyperdx/common-utils/dist/variables';

import ChartContainer from './components/charts/ChartContainer';
import {
  hasVariableIssues,
  VariableIssueIndicator,
} from './components/SQLEditor/variableValidation';

const HDXMarkdownChart = memo(
  ({
    config: { markdown },
    title,
    toolbarItems,
    variables,
  }: {
    title?: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    config: {
      markdown?: string;
    };
    variables?: ChartVariable[];
  }) => {
    const content = useMemo(() => {
      if (!markdown || variables == null) return markdown ?? '';
      try {
        return substituteVariables(markdown, {
          variables,
          inputLanguage: 'markdown',
        });
      } catch {
        // An unknown `${name:format}` throws; show the markdown as written.
        return markdown;
      }
    }, [markdown, variables]);

    const toolbar = useMemo(() => {
      // Without variables in scope nothing is substituted, so a `$word` is prose.
      if (!markdown || !variables?.length) return toolbarItems;
      const issues = validateVariableReferencesInTemplate(markdown, variables, {
        subject: 'Markdown',
        language: 'markdown',
      });
      if (!hasVariableIssues(issues)) return toolbarItems;
      return [
        <VariableIssueIndicator key="variable-issues" issues={issues} />,
        ...(toolbarItems ?? []),
      ];
    }, [markdown, variables, toolbarItems]);

    return (
      <ChartContainer
        title={title}
        toolbarItems={toolbar}
        disableReactiveContainer
      >
        <div className="hdx-markdown">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </ChartContainer>
    );
  },
);

export default HDXMarkdownChart;

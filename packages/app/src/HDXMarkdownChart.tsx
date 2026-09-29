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
    variables: referencedVariables,
    availableVariableNames,
  }: {
    title?: React.ReactNode;
    toolbarItems?: React.ReactNode[];
    config: {
      markdown?: string;
    };
    /** The variables to substitute. Limited to the ones this chart references. */
    variables?: ChartVariable[];
    /** Every variable name in scope, for flagging unknown references. */
    availableVariableNames?: string[];
  }) => {
    const content = useMemo(() => {
      if (!markdown || referencedVariables == null) return markdown ?? '';
      try {
        return substituteVariables(markdown, {
          variables: referencedVariables,
          inputLanguage: 'markdown',
        });
      } catch {
        // An unknown `${name:format}` throws; show the markdown as written.
        return markdown;
      }
    }, [markdown, referencedVariables]);

    const toolbar = useMemo(() => {
      const names =
        availableVariableNames ??
        referencedVariables?.map(variable => variable.name);

      // Without variables in scope nothing is substituted, so a `$word` is prose.
      if (!markdown || !names?.length) return toolbarItems;

      // Only names are checked for markdown, so the selections don't matter.
      const allVariables = names.map(name => ({ name, values: [] }));
      const issues = validateVariableReferencesInTemplate(
        markdown,
        allVariables,
        {
          subject: 'Markdown',
          language: 'markdown',
        },
      );
      if (!hasVariableIssues(issues)) return toolbarItems;

      return [
        <VariableIssueIndicator key="variable-issues" issues={issues} />,
        ...(toolbarItems ?? []),
      ];
    }, [markdown, availableVariableNames, referencedVariables, toolbarItems]);

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

import { useEffect, useState } from 'react';
import { UseFormGetValues, UseFormSetValue } from 'react-hook-form';
import { z } from 'zod';

export const SearchConfigSchema = z.object({
  select: z.string(),
  source: z.string(),
  where: z.string(),
  whereLanguage: z.enum(['sql', 'lucene']),
  orderBy: z.string(),
  filters: z.array(
    z.union([
      z.object({
        type: z.literal('sql_ast'),
        operator: z.enum(['=', '<', '>', '>=', '<=', '!=']),
        left: z.string(),
        right: z.string(),
      }),
      z.object({
        type: z.enum(['sql', 'lucene']),
        condition: z.string(),
      }),
    ]),
  ),
});

export type SearchConfigFromSchema = z.infer<typeof SearchConfigSchema>;

/// Interface for all suggestion engines
interface ISuggestionEngine {
  /// detect if a suggestion should be generated
  detect(input: string): boolean;
  /// message to display to user
  userMessage(key: string): string;
  /// return corrected text
  correct(input: string): string;
}

// Detects and corrects a double quote to a single quote
class DoubleQuoteSuggestion implements ISuggestionEngine {
  detect(input: string): boolean {
    let inSingleQuote = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char === "'") {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"') {
        if (inSingleQuote) continue;
        return true;
      }
    }
    return false;
  }

  userMessage(key: string): string {
    return `ClickHouse does not support double quotes (") but they were detected in ${key.toUpperCase()}. Switch to single quotes?`;
  }

  correct(input: string): string {
    let inSingleQuote = false;
    let correctedText = '';
    for (let i = 0; i < input.length; i++) {
      switch (input[i]) {
        case "'":
          inSingleQuote = !inSingleQuote;
          correctedText += input[i];
          break;
        case '"':
          correctedText += inSingleQuote ? '"' : "'";
          break;
        default:
          correctedText += input[i];
          break;
      }
    }

    return correctedText;
  }
}

// Array of all suggestion engines. Expected to handle cases for select, where, and orderBy
const suggestionEngines = [new DoubleQuoteSuggestion()];

export type Suggestion = {
  userMessage: string;
  action: () => void;
};

export function useSqlSuggestions({
  setValue,
  getValues,
  hasQueryError,
}: {
  setValue: UseFormSetValue<SearchConfigFromSchema>;
  getValues: UseFormGetValues<SearchConfigFromSchema>;
  hasQueryError: boolean;
}): Suggestion[] | null {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [toggle, setToggle] = useState(false);
  const refresh = () => setToggle(!toggle);

  useEffect(() => {
    if (!hasQueryError) {
      setSuggestions(null);
      return;
    }

    const fields: ('select' | 'where' | 'orderBy')[] = [
      'select',
      'where',
      'orderBy',
    ];
    const suggestions: Suggestion[] = [];
    for (const se of suggestionEngines) {
      for (const field of fields) {
        if (field === 'where' && getValues('whereLanguage') !== 'sql') continue;
        const input = getValues(field);
        if (se.detect(input)) {
          suggestions.push({
            userMessage: se.userMessage(field),
            action: () => {
              setValue(field, se.correct(input));
              refresh();
            },
          });
        }
      }
    }
    setSuggestions(suggestions);
  }, [hasQueryError, toggle]);

  return suggestions;
}

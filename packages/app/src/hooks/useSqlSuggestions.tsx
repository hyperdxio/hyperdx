import { useMemo } from 'react';

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
    let escaped = false;
    for (const char of input) {
      if (char === "'") {
        if (escaped) {
          escaped = false;
        } else {
          inSingleQuote = !inSingleQuote;
        }
      } else if (char === '"') {
        if (inSingleQuote) continue;
        return true;
      } else if (char === '\\') {
        escaped = true;
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
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      switch (input[i]) {
        case "'":
          if (escaped) {
            inSingleQuote = !inSingleQuote;
          } else {
            escaped = false;
          }
          correctedText += input[i];
          break;
        case '"':
          correctedText += inSingleQuote ? '"' : "'";
          break;
        case '\\':
          escaped = true;
          correctedText += input[i];
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
  userMessage: (field: string) => string;
  corrected: () => string;
};

export function useSqlSuggestions({
  input,
  enabled,
}: {
  input: string;
  enabled: boolean;
}): Suggestion[] | null {
  return useMemo(() => {
    if (!enabled) {
      return null;
    }

    const suggestions: Suggestion[] = [];
    for (const se of suggestionEngines) {
      if (se.detect(input)) {
        suggestions.push({
          userMessage: field => se.userMessage(field),
          corrected: () => se.correct(input),
        });
      }
    }
    return suggestions.length > 0 ? suggestions : null;
  }, [input, enabled]);
}

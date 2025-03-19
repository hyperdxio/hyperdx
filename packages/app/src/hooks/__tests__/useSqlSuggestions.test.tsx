import { renderHook } from '@testing-library/react';

import { useSqlSuggestions } from '../useSqlSuggestions';

describe('useSqlSuggestions', () => {
  it('should return null when enabled is false', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: 'SeverityText = "error"',
        enabled: false
      })
    );
    
    expect(result.current).toBeNull();
  });

  it('should detect double quotes and return suggestions when enabled', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: 'SeverityText = "error"',
        enabled: true
      })
    );
    
    expect(result.current).not.toBeNull();
    const suggestions = result.current!;
    expect(suggestions.length).toBe(1);
    
    const suggestion = suggestions[0];
    expect(suggestion.userMessage('where')).toBe(
      'ClickHouse does not support double quotes (") but they were detected in WHERE. Switch to single quotes?'
    );
    expect(suggestion.corrected()).toBe("SeverityText = 'error'");
  });

  it('should not detect double quotes inside single quotes', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: "SeverityText = 'John \"Doe\"'",
        enabled: true
      })
    );
    
    expect(result.current).toBeNull();
  });

  it('should handle multiple double quotes in input', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: 'SeverityText = "error" OR SeverityText = "info" OR SeverityText = "debug" OR SeverityText = "warn"',
        enabled: true
      })
    );
    
    expect(result.current).not.toBeNull();
    const suggestions = result.current!;
    expect(suggestions.length).toBe(1);
    
    const suggestion = suggestions[0];
    expect(suggestion.corrected()).toBe("SeverityText = 'error' OR SeverityText = 'info' OR SeverityText = 'debug' OR SeverityText = 'warn'");
  });

  it('should update suggestions when input changes', () => {
    const { result, rerender } = renderHook(
      (props) => useSqlSuggestions(props),
      { initialProps: { input: "SeverityText = 'err'", enabled: true } }
    );
    
    // Initially no suggestions as there are no double quotes
    expect(result.current).toBeNull();
    
    // Update input to contain double quotes
    rerender({ input: 'SeverityText = "err"', enabled: true });
    
    // Should now have a suggestion
    expect(result.current).not.toBeNull();
    expect(result.current?.length).toBe(1);
  });

  it('should handle empty input', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: '',
        enabled: true
      })
    );
    
    expect(result.current).toBeNull();
  });

  it('should handle input with escaped single quotes', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: "SeverityText = 'O\\'Reilly' AND company = \"Acme\"",
        enabled: true
      })
    );
    
    expect(result.current).not.toBeNull();
    expect(result.current?.[0].corrected()).toBe("SeverityText = 'O\\'Reilly' AND company = 'Acme'");
  });

  it('should update when enabled changes from false to true', () => {
    const { result, rerender } = renderHook(
      (props) => useSqlSuggestions(props),
      { initialProps: { input: 'SeverityText = "error"', enabled: false } }
    );
    
    // Initially no suggestions as enabled is false
    expect(result.current).toBeNull();
    
    // Update enabled to true
    rerender({ input: 'SeverityText = "error"', enabled: true });
    
    // Should now have a suggestion
    expect(result.current).not.toBeNull();
    expect(result.current?.length).toBe(1);
  });

  it('should handle mixed quotes correctly', () => {
    const { result } = renderHook(() => 
      useSqlSuggestions({
        input: "SeverityText = 'single' OR SeverityText = \"double\"",
        enabled: true
      })
    );
    
    expect(result.current).not.toBeNull();
    expect(result.current?.[0].corrected()).toBe("SeverityText = 'single' OR SeverityText = 'double'");
  });
});

import { useState } from 'react';
import { Button, Modal, TextInput } from '@mantine/core';
import { IconRobot } from '@tabler/icons-react';
import { genSearchFromEnglish } from '@hyperdx/common-utils/dist/queryParser';

interface AISearchButtonProps {
  onQueryGenerated: (query: string) => void;
  language?: 'sql' | 'lucene';
}

async function generateSearchWithLLM(englishQuery: string, language: 'sql' | 'lucene' = 'lucene'): Promise<string> {
  try {
    const response = await fetch('/api/aisearch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query: englishQuery,
        language: language
      })
    });
    
    if (!response.ok) {
      throw new Error('LLM request failed');
    }
    
    const { searchQuery } = await response.json();
    return searchQuery;
  } catch (error) {
    console.warn('LLM generation failed, falling back to basic parser', error);
    return genSearchFromEnglish(englishQuery);
  }
}

export default function AISearchButton({ onQueryGenerated, language = 'lucene' }: AISearchButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [englishQuery, setEnglishQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  console.log("HERE");
  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      const searchQuery = await generateSearchWithLLM(englishQuery, language);
      onQueryGenerated(searchQuery);
      setIsOpen(false);
      setEnglishQuery('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        onClick={() => setIsOpen(true)}
        leftSection={<IconRobot size={16} />}
        className="text-muted"
      >
        AI Search
      </Button>

      <Modal
        opened={isOpen}
        onClose={() => setIsOpen(false)}
        title="Describe what you're looking for"
        size="lg"
      >
        <div className="mb-3">
          <p className="text-muted mb-2">
            Describe in plain English what you want to find in your logs.
          </p>
          <p className="text-muted fs-8 mb-3">
            Example: "find me log lines with the words error and failed but don't include retry"
          </p>
          <TextInput
            placeholder="Describe your search..."
            value={englishQuery}
            onChange={(e) => setEnglishQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit();
              }
            }}
          />
        </div>
        <div className="d-flex justify-content-end gap-2">
          <Button variant="subtle" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isLoading}>
            Generate Search
          </Button>
        </div>
      </Modal>
    </>
  );
} 
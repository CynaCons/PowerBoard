import { useState } from 'react';

interface QuestionPromptProps {
  onCancel: () => void;
  onSubmit: (question: string) => void;
}

export function QuestionPrompt({ onCancel, onSubmit }: QuestionPromptProps) {
  const [question, setQuestion] = useState('');

  const submit = () => {
    if (question.trim()) onSubmit(question.trim());
  };

  return (
    <div className="board-question" role="dialog" aria-label="Feedback question">
      <label>
        What feedback is needed?
        <input
          autoFocus
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <div className="board-question__actions">
        <button type="button" className="board-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="board-button board-button--primary"
          disabled={!question.trim()}
          onClick={submit}
        >
          Move
        </button>
      </div>
    </div>
  );
}

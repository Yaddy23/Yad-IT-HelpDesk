import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { apiErrorMessage } from '@/lib/api';
import { knowledgeApi, type CreateArticleInput } from '@/lib/knowledgeApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';
const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';

export default function KnowledgeCreatePage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: CreateArticleInput) => knowledgeApi.create(input),
    onSuccess: (article) => {
      navigate(`/knowledge/${article.id}`);
    },
    onError: (e) => {
      setError(apiErrorMessage(e, 'Failed to create article'));
    },
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const input: CreateArticleInput = {
      title: formData.get('title') as string,
      summary: (formData.get('summary') as string) || null,
      body: formData.get('body') as string,
      category: formData.get('category') as string,
      tags: (formData.get('tags') as string).split(',').map((t) => t.trim()).filter(Boolean),
      visibility: formData.get('visibility') as CreateArticleInput['visibility'],
    };

    // Client-side validation
    if (!input.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!input.body.trim()) {
      setError('Body is required');
      return;
    }
    if (!input.category.trim()) {
      setError('Category is required');
      return;
    }

    createMutation.mutate(input);
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Create new article</h1>
        <p className="text-sm text-muted-foreground">
          Create a draft article. You can submit it for review when ready.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 border border-destructive p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div>
          <label htmlFor="title" className="mb-1 block font-medium">
            Title *
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            className={inputClass}
            placeholder="Enter article title"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="summary" className="mb-1 block font-medium">
            Summary
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={3}
            className={inputClass}
            placeholder="Brief summary (shown in search results and lists)"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional. Shown in article lists and search results.</p>
        </div>

        <div>
          <label htmlFor="body" className="mb-1 block font-medium">
            Body *
          </label>
          <textarea
            id="body"
            name="body"
            rows={25}
            required
            className={`${inputClass} font-mono`}
            placeholder="Write your article content here…"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="mb-1 block font-medium">
              Category *
            </label>
            <input
              id="category"
              name="category"
              type="text"
              required
              className={inputClass}
              placeholder="e.g., Hardware, Software, Network, Security"
            />
          </div>

          <div>
            <label htmlFor="visibility" className="mb-1 block font-medium">
              Visibility *
            </label>
            <select id="visibility" name="visibility" defaultValue="internal" className={inputClass}>
              <option value="public">Public — visible to everyone</option>
              <option value="internal">Internal — visible to staff (technicians, managers, admins)</option>
              <option value="restricted">Restricted — visible only to specific roles</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="tags" className="mb-1 block font-medium">
            Tags (comma-separated)
          </label>
          <input
            id="tags"
            name="tags"
            type="text"
            className={inputClass}
            placeholder="e.g., troubleshooting, vpn, onboarding"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional. Helps with search and categorization.</p>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <button type="button" onClick={() => navigate('/knowledge')} className={buttonGhost}>
            Cancel
          </button>
          <button type="submit" disabled={createMutation.isPending} className={buttonPrimary}>
            {createMutation.isPending ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
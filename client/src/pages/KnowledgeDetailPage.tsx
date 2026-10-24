import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { ChevronDownIcon, EditIcon, ArchiveIcon, RefreshCcwIcon, EyeIcon, EyeOffIcon, ExternalLinkIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  knowledgeApi,
  type KnowledgeRevision,
  type KnowledgeRevisionDetail,
  type KnowledgeVisibility,
  getStatusBadgeClass,
  getVisibilityBadgeClass,
  formatDate,
} from '@/lib/knowledgeApi';

const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';
const buttonDestructive =
  'cursor-pointer rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-on-destructive transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export default function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const [showRevisions, setShowRevisions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeRevision, setActiveRevision] = useState<KnowledgeRevisionDetail | null>(null);

  const articleQuery = useQuery({
    queryKey: ['knowledge', id],
    queryFn: () => knowledgeApi.get(id!),
    enabled: !!id,
  });

  const revisionsQuery = useQuery({
    queryKey: ['knowledge-revisions', id],
    queryFn: () => knowledgeApi.listRevisions(id!),
    enabled: !!id && showRevisions,
  });

  const canEdit = user && hasPermission('kb:author');
  const canPublish = user && hasPermission('kb:publish');
  const isAuthorOrOwner = user && articleQuery.data && (articleQuery.data.authorId === user.id || articleQuery.data.ownerId === user.id);
  const canManage = canEdit && (isAuthorOrOwner || canPublish);

  // Actions
  const submitMutation = useMutation({
    mutationFn: () => knowledgeApi.submitForReview(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge', id] }),
    onError: (e) => alert(apiErrorMessage(e, 'Failed to submit for review')),
  });

  const publishMutation = useMutation({
    mutationFn: () => knowledgeApi.publish(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge', id] }),
    onError: (e) => alert(apiErrorMessage(e, 'Failed to publish')),
  });

  const rejectMutation = useMutation({
    mutationFn: (note: string) => knowledgeApi.reject(id!, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge', id] });
      setShowRejectDialog(false);
    },
    onError: (e) => alert(apiErrorMessage(e, 'Failed to reject')),
  });

  const archiveMutation = useMutation({
    mutationFn: () => knowledgeApi.archive(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge', id] }),
    onError: (e) => alert(apiErrorMessage(e, 'Failed to archive')),
  });

  const restoreMutation = useMutation({
    mutationFn: () => knowledgeApi.restore(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge', id] }),
    onError: (e) => alert(apiErrorMessage(e, 'Failed to restore')),
  });

  const restoreRevisionMutation = useMutation({
    mutationFn: (revisionNumber: number) => knowledgeApi.restoreRevision(id!, revisionNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge', id] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-revisions', id] });
      setActiveRevision(null);
    },
    onError: (e) => alert(apiErrorMessage(e, 'Failed to restore revision')),
  });

  const [rejectNote, setRejectNote] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  if (articleQuery.isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted rounded w-1/4" />
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-64 bg-muted rounded" />
      </div>
    );
  }

  if (articleQuery.isError) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <p className="text-destructive">{apiErrorMessage(articleQuery.error, 'Failed to load article')}</p>
        <button onClick={() => navigate('/knowledge')} className={buttonGhost} type="button">
          Back to knowledge base
        </button>
      </div>
    );
  }

  const article = articleQuery.data!;

  if (!article) {
    return null;
  }

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const input = {
      title: formData.get('title') as string,
      summary: formData.get('summary') as string || null,
      body: formData.get('body') as string,
      category: formData.get('category') as string,
      tags: (formData.get('tags') as string).split(',').map((t) => t.trim()).filter(Boolean),
      visibility: formData.get('visibility') as KnowledgeVisibility,
      version: article.version,
    };

    try {
      await knowledgeApi.update(id!, input);
      queryClient.invalidateQueries({ queryKey: ['knowledge', id] });
      setEditing(false);
    } catch (e) {
      alert(apiErrorMessage(e, 'Failed to update article'));
    }
  };

  const handleReject = () => {
    if (rejectNote.trim().length < 5) {
      alert('Rejection note must be at least 5 characters');
      return;
    }
    rejectMutation.mutate(rejectNote);
  };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <span className={`${badgeBase} ${getStatusBadgeClass(article.status)}`}>
              {article.status.replace('_', ' ')}
            </span>
            <span className={`${badgeBase} ${getVisibilityBadgeClass(article.visibility)}`}>
              {article.visibility}
            </span>
            {article.category && (
              <span className={`${badgeBase} bg-muted text-muted-foreground`}>{article.category}</span>
            )}
          </div>
          <h1 className="text-3xl font-semibold">{article.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">By {article.author.name} · Updated {formatDate(article.updatedAt)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!editing && canEdit && canManage && (
            <button type="button" onClick={() => setEditing(true)} className={buttonGhost}>
              <EditIcon size={16} className="mr-1" />
              Edit
            </button>
          )}
          {!editing && canEdit && isAuthorOrOwner && article.status === 'draft' && (
            <button
              type="button"
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending}
              className={buttonPrimary}
            >
              {submitMutation.isPending ? 'Submitting…' : 'Submit for review'}
            </button>
          )}
          {!editing && canPublish && article.status === 'in_review' && (
            <button
              type="button"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className={buttonPrimary}
            >
              {publishMutation.isPending ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {!editing && canPublish && article.status === 'in_review' && (
            <button
              type="button"
              onClick={() => {
                setRejectNote('');
                setShowRejectDialog(true);
              }}
              className={buttonGhost}
            >
              Reject
            </button>
          )}
          {!editing && canPublish && article.status === 'published' && (
            <button
              type="button"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              className={buttonGhost}
            >
              <ArchiveIcon size={16} className="mr-1" />
              Archive
            </button>
          )}
          {!editing && canPublish && article.status === 'archived' && (
            <button
              type="button"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
              className={buttonPrimary}
            >
              <RefreshCcwIcon size={16} className="mr-1" />
              Restore
            </button>
          )}
        </div>
      </div>

      {/* Reject Dialog */}
      {showRejectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reject article"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
            <h3 className="text-base font-semibold">Reject article</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will move the article back to draft status. The author will see your note.
            </p>
            <textarea
              className="mt-4 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              rows={4}
              placeholder="Rejection note (minimum 5 characters)…"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowRejectDialog(false)} className={buttonGhost}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={rejectMutation.isPending}
                className={buttonDestructive}
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <article className="prose prose-sm max-w-none">
        {editing ? (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label htmlFor="title" className="mb-1 block font-medium">
                Title *
              </label>
              <input
                id="title"
                name="title"
                type="text"
                defaultValue={article.title}
                required
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
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
                defaultValue={article.summary ?? ''}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="body" className="mb-1 block font-medium">
                Body *
              </label>
              <textarea
                id="body"
                name="body"
                rows={20}
                defaultValue={article.body}
                required
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono"
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
                  defaultValue={article.category}
                  required
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="visibility" className="mb-1 block font-medium">
                  Visibility *
                </label>
                <select
                  id="visibility"
                  name="visibility"
                  defaultValue={article.visibility}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="restricted">Restricted</option>
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
                defaultValue={article.tags.join(', ')}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </div>

            <input type="hidden" name="version" value={String(article.version)} />

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <button type="button" onClick={() => setEditing(false)} className={buttonGhost}>
                Cancel
              </button>
              <button type="submit" className={buttonPrimary}>
                Save changes
              </button>
            </div>
          </form>
        ) : (
          <>
            {article.summary && <p className="text-muted-foreground">{article.summary}</p>}
            <div className="mt-4 whitespace-pre-wrap text-sm">{article.body}</div>
          </>
        )}

        {/* Tags */}
        {article.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <span key={tag} className="rounded px-2 py-0.5 text-xs text-muted-foreground bg-muted">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm border-t border-border pt-4">
          <div>
            <dt className="text-muted-foreground">Author</dt>
            <dd className="font-medium">{article.author.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium">{article.version}</dd>
          </div>
          {article.publishedAt && (
            <div>
              <dt className="text-muted-foreground">Published</dt>
              <dd className="font-medium">{formatDate(article.publishedAt)}</dd>
            </div>
          )}
          {article.reviewDueAt && (
            <div>
              <dt className="text-muted-foreground">Review due</dt>
              <dd className="font-medium">{formatDate(article.reviewDueAt)}</dd>
            </div>
          )}
          {article.sourceTicketId && (
            <div>
              <dt className="text-muted-foreground">Source ticket</dt>
              <dd className="font-medium flex items-center gap-1">
                {article.sourceTicketId}
                <ExternalLinkIcon size={12} />
              </dd>
            </div>
          )}
        </dl>
      </article>

      {/* Revisions */}
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setShowRevisions(!showRevisions)}
          className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon size={16} className={showRevisions ? 'rotate-180' : ''} />
          <span>{showRevisions ? 'Hide' : 'Show'} revision history ({revisionsQuery.data?.length ?? 0})</span>
        </button>

        {showRevisions && (
          <div className="mt-4 space-y-3">
            {revisionsQuery.data?.map((rev) => (
              <RevisionCard
                key={rev.revisionNumber}
                revision={rev}
                currentVersion={article.version}
                onView={() => knowledgeApi.getRevision(id!, rev.revisionNumber).then(setActiveRevision)}
                onRestore={
                  canManage
                    ? () => {
                        if (confirm(`Restore revision ${rev.revisionNumber} as a new draft? This creates revision ${article.version + 1}.`)) {
                          restoreRevisionMutation.mutate(rev.revisionNumber);
                        }
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {activeRevision && (
          <RevisionDetailDialog
            revision={activeRevision}
            onClose={() => setActiveRevision(null)}
          />
        )}
      </div>
    </div>
  );
}

function RevisionCard({
  revision,
  currentVersion,
  onView,
  onRestore,
}: {
  revision: KnowledgeRevision;
  currentVersion: number;
  onView: () => void;
  onRestore?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono font-medium">Revision {revision.revisionNumber}</span>
            <span className="text-muted-foreground">{formatDate(revision.createdAt)}</span>
            <span className="text-muted-foreground">by {revision.editor.name}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{revision.changeNote || 'No change note'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`${badgeBase} bg-muted text-muted-foreground`}>{revision.visibility}</span>
            {revision.tags.length > 0 && (
              <>
                {revision.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted">
                    {tag}
                  </span>
                ))}
                {revision.tags.length > 2 && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted">
                    +{revision.tags.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onView} className={buttonGhost}>
            <EyeIcon size={14} className="mr-1" />
            View
          </button>
          {onRestore && revision.revisionNumber !== currentVersion && (
            <button type="button" onClick={onRestore} className={buttonGhost}>
              <RefreshCcwIcon size={14} className="mr-1" />
              Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RevisionDetailDialog({
  revision,
  onClose,
}: {
  revision: KnowledgeRevisionDetail;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Revision ${revision.revisionNumber}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Revision {revision.revisionNumber}</h3>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-muted">
            <EyeOffIcon size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <p><strong>Title:</strong> {revision.title}</p>
          {revision.summary && <p><strong>Summary:</strong> {revision.summary}</p>}
          <p><strong>Category:</strong> {revision.category}</p>
          <p><strong>Visibility:</strong> {revision.visibility}</p>
          {revision.tags.length > 0 && <p><strong>Tags:</strong> {revision.tags.join(', ')}</p>}
          {revision.allowedRoles.length > 0 && (
            <p><strong>Allowed roles:</strong> {revision.allowedRoles.join(', ')}</p>
          )}
          <p><strong>Edited by:</strong> {revision.editor.name}</p>
          <p><strong>Date:</strong> {formatDate(revision.createdAt)}</p>
          <p><strong>Change note:</strong> {revision.changeNote || 'No change note'}</p>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <h4 className="font-medium mb-2">Content</h4>
          <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-3 rounded max-h-64 overflow-y-auto">{revision.body}</pre>
        </div>
      </div>
    </div>
  );
}
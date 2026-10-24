import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { ExternalLinkIcon, SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import {
  knowledgeApi,
  type KnowledgeArticleSummary,
  type KnowledgeStatus,
  type KnowledgeVisibility,
  getStatusBadgeClass,
  getVisibilityBadgeClass,
  formatDate,
} from '@/lib/knowledgeApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';
const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';
const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export default function KnowledgePage() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<KnowledgeStatus | ''>('');
  const [selectedVisibility, setSelectedVisibility] = useState<KnowledgeVisibility | ''>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const categoriesQuery = useQuery({ queryKey: ['knowledge-categories'], queryFn: knowledgeApi.listCategories });

  const query: Record<string, string> = {};
  if (searchQuery.trim()) query.q = searchQuery.trim();
  if (selectedCategory) query.category = selectedCategory;
  if (selectedStatus) query.status = selectedStatus;
  if (selectedVisibility) query.visibility = selectedVisibility;
  query.page = String(page);
  query.limit = '20';

  const articlesQuery = useQuery({
    queryKey: ['knowledge', query],
    queryFn: () => knowledgeApi.list(query),
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setPage(1);
    },
    [],
  );

  const handleCategoryChange = useCallback(
    (category: string) => {
      setSelectedCategory(category);
      setPage(1);
    },
    [],
  );

  const handleStatusChange = useCallback(
    (status: KnowledgeStatus | '') => {
      setSelectedStatus(status);
      setPage(1);
    },
    [],
  );

  const handleVisibilityChange = useCallback(
    (visibility: KnowledgeVisibility | '') => {
      setSelectedVisibility(visibility);
      setPage(1);
    },
    [],
  );

  const handleCreateArticle = useCallback(() => {
    navigate('/knowledge/new');
  }, [navigate]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge base</h1>
          <p className="text-sm text-muted-foreground">
            Search and browse articles. Authors can create and manage drafts.
          </p>
        </div>
        <button type="button" onClick={handleCreateArticle} className={buttonPrimary}>
          New article
        </button>
      </div>

      {/* Search and filters */}
      <form onSubmit={handleSearch} className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search articles…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`${inputClass} pl-9`}
            aria-label="Search articles"
          />
        </div>

        <div className="min-w-[160px]">
          <label htmlFor="category-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="category-filter"
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className={inputClass}
          >
            <option value="">All categories</option>
            {categoriesQuery.data?.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label htmlFor="status-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status-filter"
            value={selectedStatus}
            onChange={(e) => handleStatusChange(e.target.value as KnowledgeStatus | '')}
            className={inputClass}
          >
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="in_review">In review</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="min-w-[160px]">
          <label htmlFor="visibility-filter" className="mb-1 block text-xs font-medium text-muted-foreground">
            Visibility
          </label>
          <select
            id="visibility-filter"
            value={selectedVisibility}
            onChange={(e) => handleVisibilityChange(e.target.value as KnowledgeVisibility | '')}
            className={inputClass}
          >
            <option value="">All visibility</option>
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>

        <button type="submit" className={buttonPrimary}>
          Search
        </button>

        {(searchQuery || selectedCategory || selectedStatus || selectedVisibility) && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('');
              setSelectedStatus('');
              setSelectedVisibility('');
              setPage(1);
            }}
            className={buttonGhost}
          >
            Clear
          </button>
        )}
      </form>

      {/* Results */}
      {articlesQuery.isLoading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : articlesQuery.isError ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {apiErrorMessage(articlesQuery.error, 'Failed to load articles')}
        </p>
      ) : !articlesQuery.data || articlesQuery.data.articles.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No articles found.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {articlesQuery.data!.articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

          {/* Pagination */}
          {articlesQuery.data!.pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={buttonGhost}
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {articlesQuery.data!.pages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(articlesQuery.data!.pages, p + 1))}
                disabled={page === articlesQuery.data!.pages}
                className={buttonGhost}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ArticleCard({ article }: { article: KnowledgeArticleSummary }) {
  return (
    <Link
      to={`/knowledge/${article.id}`}
      className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium line-clamp-1 flex-1">{article.title}</h3>
        <span className={`${badgeBase} ${getStatusBadgeClass(article.status)} shrink-0`}>
          {article.status.replace('_', ' ')}
        </span>
      </div>
      {article.summary && (
        <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">{article.summary}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`${badgeBase} ${getVisibilityBadgeClass(article.visibility)}`}>
          {article.visibility}
        </span>
        {article.category && (
          <span className={`${badgeBase} bg-muted text-muted-foreground`}>{article.category}</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>By {article.author.name}</span>
        <span>{formatDate(article.updatedAt)}</span>
      </div>
      {article.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {article.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted">
              {tag}
            </span>
          ))}
          {article.tags.length > 3 && (
            <span className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted">
              +{article.tags.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          👍 {article.helpfulCount} · 👎 {article.notHelpfulCount}
        </span>
        <ExternalLinkIcon size={12} />
      </div>
    </Link>
  );
}
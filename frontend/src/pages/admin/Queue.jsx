/**
 * BullMQ queue monitor (US-NOTIF-4).
 *
 * Makes the background-job layer inspectable: counts by state, the jobs
 * currently waiting, the ones that failed with their reason and attempt count,
 * and the ones scheduled for later. Admin-only — queue internals are
 * operational detail (AC4).
 *
 * Polls rather than streams: a 10s refresh is enough for an operations view and
 * costs one cheap request, where a socket would be new infrastructure for no
 * real gain.
 */
import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useFetch } from '../../hooks/useFetch';
import { formatDateTime } from '../../utils/format';
import { Tone } from '../../utils/status';
import { EmptyState, EmptyNotice } from '../../components/States';
import { PageHeader, Panel, StatCard } from '../../components/admin/Primitives';
import { RefreshIcon, ClockIcon, CheckIcon, AlertIcon, RetryIcon, QueueIcon, PlugOffIcon } from '../../components/Icons';
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const POLL_MS = 10_000;

/** One job row. Shared by all three lists so they cannot style differently. */
function JobRow({ job, tone = Tone.NEUTRAL, detail }) {
  // Keyed by the shared tone vocabulary rather than a private colour map.
  const dots = {
    [Tone.NEUTRAL]: 'bg-surface-active',
    [Tone.WARNING]: 'bg-warning',
    [Tone.DANGER]: 'bg-danger-strong',
  };
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dots[tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-content">{job.name}</span>
          <code className="text-eyebrow text-content-subtle">#{job.id}</code>
        </div>
        {job.timestamp && (
          <p className="mt-0.5 text-eyebrow text-content-muted">Queued {formatDateTime(job.timestamp)}</p>
        )}
        {detail}
      </div>
    </li>
  );
}

/** Panel wrapper for a job list, with its own empty state. */
function JobList({ title, description, jobs, tone, emptyMessage, renderDetail }) {
  return (
    <Panel title={title} description={description}>
      {jobs.length === 0 ? (
        <EmptyNotice message={emptyMessage} />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} tone={tone} detail={renderDetail?.(j)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function Queue() {
  useDocumentTitle("Queue · Admin");
  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get('/api/notifications/queue/status', { signal }),
    [],
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (state === 'success') setLastUpdated(new Date());
  }, [state, data]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(refetch, POLL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refetch]);

  const counts = data?.counts ?? {};
  const loading = state === 'loading' && !data;

  // Only take over the screen when there is nothing to show. This polls every
  // 10s, and letting one transient failure replace a populated dashboard would
  // wipe the view out from under an operator watching it.
  if (state === 'error' && !data) {
    return (
      <div>
        <PageHeader title="Queue" description="BullMQ background jobs." />
        <EmptyState
          icon={PlugOffIcon}
          title="Cannot read the queue"
          message={
            error?.status === 0
              ? 'The notification service is unreachable. Check that Redis and the service are running.'
              : error?.message
          }
          action={
            <button type="button" onClick={refetch} className="btn-secondary">
              <RefreshIcon className="h-4 w-4" />
              Try again
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Queue"
        description={data?.queue ? `BullMQ queue “${data.queue}”, backed by Redis.` : 'BullMQ background jobs.'}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-meta text-content-secondary">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-line-strong text-primary"
              />
              Auto-refresh
            </label>
            <button type="button" onClick={refetch} className="btn-secondary h-9 px-3 py-0">
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
          </div>
        }
      />

      {/* A refresh failed but earlier figures are still on screen. Say so
          rather than silently showing numbers that are quietly going stale. */}
      {state === 'error' && data && (
        <div
          className="mb-4 flex items-center gap-2.5 rounded-control border border-warning-border bg-warning-soft px-3.5 py-2.5 text-meta text-warning-text"
          role="status"
        >
          <AlertIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1">Could not refresh — the figures below may be out of date.</span>
          <button type="button" onClick={refetch} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="Waiting" value={counts.waiting ?? 0} icon={ClockIcon} tone={Tone.NEUTRAL} loading={loading} />
        <StatCard label="Active" value={counts.active ?? 0} icon={QueueIcon} tone={Tone.PRIMARY} loading={loading} />
        <StatCard label="Completed" value={counts.completed ?? 0} icon={CheckIcon} tone={Tone.SUCCESS} loading={loading} />
        <StatCard
          label="Failed"
          value={counts.failed ?? 0}
          icon={AlertIcon}
          tone={counts.failed > 0 ? Tone.DANGER : Tone.NEUTRAL}
          loading={loading}
        />
        <StatCard label="Delayed" value={counts.delayed ?? 0} icon={RetryIcon} tone={Tone.WARNING} loading={loading} />
      </div>

      {lastUpdated && (
        // Polite: a background refresh must not interrupt whatever the admin is
        // reading.
        <p className="mt-3 text-eyebrow text-content-muted" aria-live="polite">
          Updated {formatDateTime(lastUpdated)}
          {autoRefresh && ` · refreshing every ${POLL_MS / 1000}s`}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <JobList
          title="Failed jobs"
          description="Exhausted every retry attempt."
          jobs={data?.failed ?? []}
          tone={Tone.DANGER}
          emptyMessage="No failed jobs. Every notification has been delivered."
          renderDetail={(j) => (
            <>
              {j.failedReason && (
                <p className="mt-1.5 rounded-control bg-danger-soft px-2.5 py-1.5 text-eyebrow text-danger-text">
                  {j.failedReason}
                </p>
              )}
              {j.attemptsMade != null && (
                <p className="mt-1 text-eyebrow tabular-nums text-content-muted">
                  {j.attemptsMade} attempt{j.attemptsMade === 1 ? '' : 's'} made
                </p>
              )}
            </>
          )}
        />

        <JobList
          title="Waiting"
          description="Queued, not yet picked up by a worker."
          jobs={data?.waiting ?? []}
          tone={Tone.NEUTRAL}
          emptyMessage="Nothing waiting — the worker is keeping up."
        />

        <JobList
          title="Delayed"
          description="Scheduled to run later."
          jobs={data?.delayed ?? []}
          tone={Tone.WARNING}
          emptyMessage="No delayed jobs scheduled."
          renderDetail={(j) =>
            j.delayUntil && (
              <p className="mt-1 text-eyebrow text-content-muted">Runs at {formatDateTime(j.delayUntil)}</p>
            )
          }
        />

        <Panel title="How this works">
          <ol className="space-y-2.5 text-meta text-content-secondary">
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-hover text-eyebrow font-semibold tabular-nums text-content-secondary">1</span>
              An order is placed or a payment settles.
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-hover text-eyebrow font-semibold tabular-nums text-content-secondary">2</span>
              A job is added to the BullMQ queue, held in Redis.
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-hover text-eyebrow font-semibold tabular-nums text-content-secondary">3</span>
              The notification worker picks it up and sends the push notification.
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-hover text-eyebrow font-semibold tabular-nums text-content-secondary">4</span>
              A failure is retried with backoff; once attempts are exhausted the job lands in
              <span className="font-medium text-content"> Failed</span> with its reason.
            </li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}

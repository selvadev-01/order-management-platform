/**
 * Order management (US-ADMIN-6..8).
 *
 * Shows the seven fields the brief requires — order ID, customer, products,
 * amount, payment status, order status, created date — and advances orders
 * through Pending → Confirmed → Processing → Shipped → Delivered.
 *
 * The pipeline is rendered as a visible progress track rather than a bare
 * status word, because "where is this order" is the question this screen exists
 * to answer.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../services/api';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { formatMoney, formatDateTime, formatOrderRef, statusClasses } from '../../utils/format';
import { Spinner, EmptyState } from '../../components/States';
import { PageHeader, Toolbar, FilterChips, Pagination } from '../../components/admin/Primitives';
import DataTable, { CellStack, CellActions } from '../../components/admin/DataTable';
import { CheckIcon, ChevronRightIcon, OrdersIcon } from '../../components/Icons';
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const FLOW = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];

/** The single next status, rather than a free dropdown of everything. */
function nextStatus(current) {
  const i = FLOW.indexOf(current);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

/**
 * Compact pipeline indicator: five segments, filled up to the current stage.
 *
 * Position is conveyed by fill *and* the adjacent status text, never colour
 * alone; the whole track carries a text label for screen readers.
 */
function Pipeline({ status }) {
  const idx = FLOW.indexOf(status);
  return (
    <div
      className="flex items-center gap-1"
      role="img"
      aria-label={`Stage ${idx + 1} of ${FLOW.length}: ${status}`}
    >
      {FLOW.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 w-5 rounded-full transition-colors ${
            i <= idx ? 'bg-primary' : 'bg-surface-active'
          }`}
        />
      ))}
    </div>
  );
}

function AdvanceButton({ order, onAdvance, busy }) {
  const next = nextStatus(order.orderStatus);

  // Delivered is terminal (US-ADMIN-8 AC3).
  if (!next) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-eyebrow font-medium text-success">
        <CheckIcon className="h-4 w-4" />
        Complete
      </span>
    );
  }

  /**
   * Blocked past Confirmed until payment lands. The server enforces this too;
   * disabling here explains why rather than letting the click fail.
   */
  const blocked = next !== 'Confirmed' && order.paymentStatus !== 'Paid';

  return (
    <button
      type="button"
      onClick={() => onAdvance(order, next)}
      disabled={busy || blocked}
      className="btn-primary h-9 whitespace-nowrap px-3 py-0 text-eyebrow"
      title={blocked ? 'Payment must be completed first' : `Advance to ${next}`}
      aria-label={`Mark order ${formatOrderRef(order)} as ${next}`}
    >
      {busy ? <Spinner /> : <ChevronRightIcon className="h-4 w-4" />}
      {`Mark ${next}`}
    </button>
  );
}

export default function Orders() {
  useDocumentTitle("Orders · Admin");
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [busyId, setBusyId] = useState(null);

  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get(`/api/orders/admin${qs({ page, limit: 20, status })}`, { signal }),
    [page, status],
  );

  const items = data?.items ?? [];

  const advance = async (order, next) => {
    setBusyId(order.id);
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: next });
      toast.success(`Order ${formatOrderRef(order)} marked ${next}`);
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    {
      key: 'id',
      header: 'Order',
      mobile: 'title',
      cell: (o) => (
        <Link
          to={`/orders/${o.id}`}
          className="font-medium tabular-nums text-primary hover:underline"
        >
          {formatOrderRef(o)}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      mobile: 'meta',
      className: 'max-w-[12rem]',
      cell: (o) => <CellStack primary={o.customer?.name ?? '—'} secondary={o.customer?.email} />,
    },
    {
      key: 'items',
      header: 'Products',
      className: 'max-w-[14rem]',
      // Summarised here; the full list lives on the order detail view.
      cell: (o) => (
        <span className="block truncate text-content-secondary">
          {o.items?.[0]?.name ?? '—'}
          {o.items?.length > 1 && (
            <span className="text-content-subtle"> +{o.items.length - 1} more</span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      mobile: 'trailing',
      cell: (o) => <span className="font-medium tabular-nums">{formatMoney(o.totalAmount)}</span>,
    },
    {
      key: 'payment',
      header: 'Payment',
      mobile: 'badge',
      cell: (o) => <span className={statusClasses(o.paymentStatus)}>{o.paymentStatus}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (o) => (
        <div className="space-y-1.5">
          <span className={statusClasses(o.orderStatus)}>{o.orderStatus}</span>
          <Pipeline status={o.orderStatus} />
        </div>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (o) => (
        <span className="whitespace-nowrap text-content-muted">{formatDateTime(o.createdAt)}</span>
      ),
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'right',
      mobile: 'actions',
      cell: (o) => (
        <CellActions>
          <AdvanceButton order={o} onAdvance={advance} busy={busyId === o.id} />
        </CellActions>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Orders" description="Track and fulfil customer orders." />

      <Toolbar>
        <FilterChips
          label="Filter by order status"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={[
            { value: '', label: 'All' },
            ...FLOW.map((s) => ({ value: s, label: s })),
          ]}
        />
        {data?.total != null && (
          <p className="ml-auto text-meta tabular-nums text-content-muted">
            {data.total} order{data.total === 1 ? '' : 's'}
          </p>
        )}
      </Toolbar>

      <DataTable
        caption="Customer orders"
        columns={columns}
        rows={items}
        rowKey={(o) => o.id}
        state={state}
        error={error}
        onRetry={refetch}
        // Eight columns need real width, so the table only appears from lg up.
        breakpoint="lg"
        empty={
          <EmptyState
            icon={OrdersIcon}
            title={status ? `No ${status.toLowerCase()} orders` : 'No orders yet'}
            message={
              status
                ? 'Try a different status filter.'
                : 'Orders appear here once customers place them.'
            }
            action={
              status ? (
                <button type="button" onClick={() => setStatus('')} className="btn-secondary">
                  Show all orders
                </button>
              ) : undefined
            }
          />
        }
      />

      <Pagination
        page={data?.page ?? page}
        totalPages={data?.totalPages}
        hasPrev={data?.hasPrev}
        hasNext={data?.hasNext}
        onChange={setPage}
      />
    </div>
  );
}

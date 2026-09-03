/**
 * Admin overview.
 *
 * Derived entirely from the existing admin list endpoints — no new backend
 * surface. The figures are therefore honest about their scope: they describe
 * the most recent orders the API returns, and the copy says so rather than
 * implying an all-time total the client cannot actually compute.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../services/api';
import { useFetch } from '../../hooks/useFetch';
import { formatMoney, formatDateTime, formatOrderRef, statusClasses } from '../../utils/format';
import { Tone, stockBadge } from '../../utils/status';
import { PageHeader, Panel, StatCard } from '../../components/admin/Primitives';
import DataTable, { CellStack } from '../../components/admin/DataTable';
import { EmptyState, EmptyNotice } from '../../components/States';
import { OrdersIcon, RevenueIcon, ClockIcon, AlertIcon, CheckIcon, ChevronRightIcon } from '../../components/Icons';
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

/** Stock at or below this is worth an admin's attention. */
const LOW_STOCK = 5;
const WINDOW = 50;

export default function Dashboard() {
  useDocumentTitle("Dashboard · Admin");
  const orders = useFetch(
    ({ signal }) => api.get(`/api/orders/admin${qs({ page: 1, limit: WINDOW })}`, { signal }),
    [],
  );
  const products = useFetch(
    ({ signal }) => api.get(`/api/products/admin/all${qs({ page: 1, limit: 100 })}`, { signal }),
    [],
  );

  const orderItems = orders.data?.items ?? [];
  const productItems = products.data?.items ?? [];

  const stats = useMemo(() => {
    // Revenue counts settled money only — an order marked Paid. Counting
    // pending orders would overstate takings.
    const revenue = orderItems
      .filter((o) => o.paymentStatus === 'Paid')
      .reduce((sum, o) => sum + (o.totalAmount ?? 0), 0);

    const awaitingPayment = orderItems.filter((o) => o.paymentStatus !== 'Paid').length;

    // Anything paid for but not yet handed over is work outstanding.
    const toFulfil = orderItems.filter(
      (o) => o.paymentStatus === 'Paid' && o.orderStatus !== 'Delivered',
    ).length;

    return { revenue, awaitingPayment, toFulfil, count: orderItems.length };
  }, [orderItems]);

  const lowStock = useMemo(
    () => productItems
      .filter((p) => !p.isDeleted && (p.stock ?? 0) <= LOW_STOCK)
      .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
      .slice(0, 6),
    [productItems],
  );

  const recent = orderItems.slice(0, 6);

  const recentColumns = [
    {
      key: 'id',
      header: 'Order',
      mobile: 'title',
      cell: (o) => (
        <Link to={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
          {formatOrderRef(o)}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      mobile: 'meta',
      cell: (o) => <CellStack primary={o.customer?.name ?? '—'} secondary={o.customer?.email} />,
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'badge',
      cell: (o) => (
        <div className="flex flex-wrap gap-1.5">
          <span className={statusClasses(o.paymentStatus)}>{o.paymentStatus}</span>
          <span className={statusClasses(o.orderStatus)}>{o.orderStatus}</span>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Placed',
      cell: (o) => <span className="whitespace-nowrap text-content-muted">{formatDateTime(o.createdAt)}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      mobile: 'trailing',
      cell: (o) => <span className="font-medium tabular-nums">{formatMoney(o.totalAmount)}</span>,
    },
  ];

  const loading = orders.state === 'loading';

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`Activity across the ${WINDOW} most recent orders.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Settled revenue"
          value={formatMoney(stats.revenue)}
          hint="Paid orders in this window"
          icon={RevenueIcon}
          tone={Tone.SUCCESS}
          loading={loading}
        />
        <StatCard
          label="Recent orders"
          value={stats.count}
          hint={orders.data?.total != null ? `${orders.data.total} in total` : undefined}
          icon={OrdersIcon}
          tone={Tone.PRIMARY}
          loading={loading}
        />
        <StatCard
          label="Awaiting payment"
          value={stats.awaitingPayment}
          hint="Not yet settled"
          icon={ClockIcon}
          tone={Tone.WARNING}
          loading={loading}
        />
        <StatCard
          label="To fulfil"
          value={stats.toFulfil}
          hint="Paid, not yet delivered"
          icon={AlertIcon}
          tone={stats.toFulfil > 0 ? Tone.DANGER : Tone.NEUTRAL}
          loading={loading}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel
            title="Recent orders"
            bodyClass="p-0 sm:p-0"
            actions={
              <Link to="/admin/orders" className="btn-secondary h-9 px-3 py-0 text-eyebrow">
                View all
                <ChevronRightIcon className="h-4 w-4" />
              </Link>
            }
          >
            <div className="p-4 sm:p-5">
              <DataTable
                caption="Six most recent orders"
                columns={recentColumns}
                rows={recent}
                rowKey={(o) => o.id}
                state={orders.state}
                error={orders.error}
                onRetry={orders.refetch}
                breakpoint="lg"
                empty={
                  <EmptyState
                    icon={OrdersIcon}
                    title="No orders yet"
                    message="Orders appear here as customers place them."
                  />
                }
              />
            </div>
          </Panel>
        </div>

        <Panel
          title="Low stock"
          description={`At or below ${LOW_STOCK} units`}
          actions={
            <Link to="/admin/products" className="btn-secondary h-9 px-3 py-0 text-eyebrow">
              Restock
            </Link>
          }
        >
          {products.state === 'loading' && (
            <div className="space-y-3" role="status" aria-label="Loading stock levels">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-control bg-surface-hover" />
              ))}
            </div>
          )}

          {products.state === 'success' && lowStock.length === 0 && (
            <EmptyNotice message="Every product is comfortably stocked." icon={CheckIcon} />
          )}

          {products.state === 'success' && lowStock.length > 0 && (
            <ul className="divide-y divide-line-subtle">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-meta text-content-secondary">{p.name}</span>
                  {/* Colour plus the word "left" — never colour alone. */}
                  <span className={`${stockBadge(p.stock, { lowAt: LOW_STOCK })} shrink-0 tabular-nums`}>
                    {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

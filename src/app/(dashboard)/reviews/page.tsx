import Link from "next/link";
import { requirePermission, toContext } from "@/server/auth/guard";
import { listReviews, ratingBreakdown } from "@/server/modules/reviews/review.service";
import { listReviewsSchema } from "@/server/modules/reviews/review.schema";
import { Card, CardHeader, EmptyState, PageHeader, StatTile } from "@/components/ui/primitives";
import { Stars } from "@/components/ui/badges";
import { FilterSelect, Pagination } from "@/components/ui/table-tools";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews · Restaurant CRM" };

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("reviews:read");
  const ctx = toContext(user);
  const query = listReviewsSchema.parse(await searchParams);

  const [list, breakdown] = await Promise.all([listReviews(ctx, query), ratingBreakdown(ctx)]);
  const maxCount = Math.max(1, ...breakdown.map((b) => b.count));

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Ratings collected over WhatsApp by n8n after each delivery."
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <StatTile
          label="Average rating"
          value={list.summary.averageRating ? `${list.summary.averageRating} ★` : "—"}
          tone="brand"
        />
        <StatTile label="Total reviews" value={list.summary.totalReviews} />
        <Card className="lg:col-span-2">
          <div className="space-y-1.5 px-4 py-3">
            {breakdown.map((row) => (
              <div key={row.rating} className="flex items-center gap-2 text-xs">
                <span className="w-8 tabular-nums text-ink-muted">{row.rating} ★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${(row.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-ink-muted">{row.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="All reviews"
          action={
            <FilterSelect
              name="rating"
              label="Rating"
              options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} stars` }))}
            />
          }
        />

        {list.data.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description="After an order is delivered, n8n asks the customer to rate it and posts the result back here."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {list.data.map((review) => (
                <li key={review.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Stars rating={review.rating} />
                      <Link href={`/customers/${review.customer.id}`} className="text-sm font-medium text-ink hover:underline">
                        {review.customer.name ?? review.customer.whatsappNumber}
                      </Link>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-ink-subtle">
                      <Link href={`/orders/${review.order.id}`} className="hover:underline">
                        {review.order.orderNumber}
                      </Link>
                      <span>{formatDateTime(review.createdAt)}</span>
                    </div>
                  </div>
                  {review.comment ? <p className="mt-2 text-sm text-ink">{review.comment}</p> : null}
                </li>
              ))}
            </ul>
            <Pagination page={list.meta.page} pageSize={list.meta.pageSize} total={list.meta.total} />
          </>
        )}
      </Card>
    </>
  );
}

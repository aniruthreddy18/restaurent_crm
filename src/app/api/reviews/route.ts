import { withApi } from "@/server/http/handler";
import { created, ok } from "@/server/http/responses";
import { createReviewSchema, listReviewsSchema } from "@/server/modules/reviews/review.schema";
import { createReview, listReviews } from "@/server/modules/reviews/review.service";

export const GET = withApi(
  { permission: "reviews:read", querySchema: listReviewsSchema },
  async ({ ctx, query }) => ok(await listReviews(ctx, query)),
);

/** n8n posts here when the customer replies to the rating request. */
export const POST = withApi(
  { permission: "reviews:write", bodySchema: createReviewSchema },
  async ({ ctx, body }) => {
    const { review, created: isNew } = await createReview(ctx, body);
    const payload = { ...review, replayed: !isNew };
    return isNew ? created(payload) : ok(payload);
  },
);

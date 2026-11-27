import type { Db, Queryable } from "../db/client.ts";

export class UnknownProduct extends Error {}

export interface PlacedOrder {
  id: string;
  totalCents: number;
  lines: { productId: string; quantity: number; unitPriceCents: number }[];
  createdAt: Date;
}

/** Active products by id, with their current price. */
async function prices(db: Queryable, ids: string[]): Promise<Map<string, number>> {
  const rows = await db.query<{ id: string; price_cents: number }>("select id, price_cents from products where id = any($1::uuid[]) and active", [ids]);
  return new Map(rows.map((r) => [r.id, r.price_cents]));
}

/**
 * WRONG on purpose: the outbox row is written outside the order's transaction, right after it commits. When that write fails (or the
 * server stops between the two), the order is stored and its confirmation is never owed: the email is lost. The
 * held-out test that makes the outbox write fail catches it.
 */
export async function placeOrder(db: Db, o: { teamId: string; userId: string; lines: { productId: string; quantity: number }[] }): Promise<PlacedOrder> {
  const placed = await db.transaction(async (tx) => {
    const price = await prices(tx, [...new Set(o.lines.map((l) => l.productId))]);
    const lines = o.lines.map((l) => {
      const unitPriceCents = price.get(l.productId);
      if (unitPriceCents === undefined) throw new UnknownProduct();
      return { productId: l.productId, quantity: l.quantity, unitPriceCents };
    });
    const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    const [order] = await tx.query<{ id: string; created_at: Date }>(
      "insert into orders (team_id, placed_by, total_cents) values ($1, $2, $3) returning id, created_at",
      [o.teamId, o.userId, totalCents],
    );
    for (const [i, l] of lines.entries()) {
      await tx.query("insert into order_lines (order_id, line_no, product_id, quantity, unit_price_cents) values ($1, $2, $3, $4, $5)", [
        order!.id,
        i + 1,
        l.productId,
        l.quantity,
        l.unitPriceCents,
      ]);
    }
    return { id: order!.id, totalCents, lines, createdAt: order!.created_at };
  });
  const [user] = await db.query<{ email: string }>("select email from users where id = $1", [o.userId]);
  await db.query("insert into outbox (kind, payload) values ('order.confirmation', $1)", [JSON.stringify({ orderId: placed.id, to: user!.email, totalCents: placed.totalCents })]);
  return placed;
}

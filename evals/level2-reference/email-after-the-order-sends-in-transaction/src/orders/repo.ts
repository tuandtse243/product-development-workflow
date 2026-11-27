import type { Db, Queryable } from "../db/client.ts";
import type { Mailer } from "../mail/mailer.ts";

export class UnknownProduct extends Error {}

export interface PlacedOrder {
  id: string;
  totalCents: number;
  lines: { productId: string; quantity: number; unitPriceCents: number }[];
  createdAt: Date;
}

async function prices(db: Queryable, ids: string[]): Promise<Map<string, number>> {
  const rows = await db.query<{ id: string; price_cents: number }>("select id, price_cents from products where id = any($1::uuid[]) and active", [ids]);
  return new Map(rows.map((r) => [r.id, r.price_cents]));
}

/** WRONG on purpose: the confirmation is sent from inside the transaction, after the order and before its lines; no outbox. */
export async function placeOrder(db: Db, mailer: Mailer, o: { teamId: string; userId: string; lines: { productId: string; quantity: number }[] }): Promise<PlacedOrder> {
  return db.transaction(async (tx) => {
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
    const [user] = await tx.query<{ email: string }>("select email from users where id = $1", [o.userId]);
    await mailer.send({ to: user!.email, subject: "Order received", text: `Your order ${order!.id} is placed.` }, { timeoutMs: 10_000, idempotencyKey: order!.id });
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
}

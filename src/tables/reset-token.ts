/**
 * The `password_reset_token` table, minted per {@link createPasswordReset} call.
 *
 * A FACTORY, not a module-level def: the `owner` column is an `f.tableRef` at
 * the CONSUMER's auth table, and `f.tableRef` resolves its target's guid
 * eagerly, at column-construction time. A module-level def would freeze
 * whatever table it saw when this module was first evaluated, and two consumers
 * in one process would share the wrong one.
 */
import { table, f, type InferRow, type TableDef } from "@xano/sdk";

export const createResetTokenTable = (authTable: TableDef) =>
  table({
    name: "password_reset_token",
    description: "One outstanding password-reset link. Single-use, and expires.",
    // Pinned: a table with no explicit useXdo inherits the CONSUMER workspace's
    // use_xdo at export, which would silently change this table's storage mode
    // depending on whose workspace it lands in.
    useXdo: false,
    // `id` and `created_at` are auto-injected - declaring them is redundant.
    schema: {
      owner: f.tableRef(authTable, {
        required: true,
        description: "The user whose password this token resets.",
      }),
      // `access: "internal"` keeps the token out of every API response, even
      // one that returns the whole row: it is a bearer credential for an
      // account, so a read that echoes it hands over the account. The stack
      // never needs it back - it MATCHES on it - so nothing here has to
      // override the visibility with an `output` list.
      token: f.text({
        required: true,
        access: "internal",
        sensitive: true,
        description: "The secret in the emailed link. Never returned by any endpoint.",
      }),
      expires_at: f.timestamp({
        required: true,
        description: "Epoch-ms after which the confirm endpoint refuses this token.",
      }),
      used_at: f.timestamp({
        nullable: true,
        description: "Epoch-ms the token was spent. Non-null means it is finished.",
      }),
    },
    index: [
      // Unique, not merely indexed: the confirm endpoint fetches by this column
      // with a single-row `db.get`, so a duplicate token would resolve to an
      // arbitrary one of the rows that carry it.
      { type: "unique", fields: [{ name: "token" }] },
      // Confirm invalidates the owner's other outstanding tokens, which reads
      // by owner. Without the index that read scans the table and gets slower
      // with every reset anyone has ever requested.
      { type: "btree", fields: [{ name: "owner", op: "asc" }] },
    ],
  });

/** One `password_reset_token` row, as the engine stores it. */
export type PasswordResetToken = InferRow<ReturnType<typeof createResetTokenTable>>;

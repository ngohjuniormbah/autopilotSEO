Apply locally with `npm run db:local` from `workers/api`.

After creating a D1 database, update `database_id` in `wrangler.toml`, then apply remotely with `npm run db:remote`. Wrangler executes the checked-in SQL migration files in order.

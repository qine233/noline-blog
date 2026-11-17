// Shared Hono context type. `userId` is set by the admin auth middleware,
// so handlers on authenticated routes can read it type-safely.
export type AppEnv = {
  Variables: {
    userId: number;
  };
};

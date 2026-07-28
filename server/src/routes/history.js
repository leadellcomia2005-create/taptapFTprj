import { Router } from "express";
import { listHistoryPage } from "../application/history.js";
import { historyCollectionParamsSchema, historyListQuerySchema } from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateParams, validateQuery } from "../middleware/validation.js";

export function createHistoryRouter({ firebase, authentication }) {
  const router = Router();
  const { authenticate } = authentication;

  router.get(
    "/history/:collection",
    authenticate,
    validateParams(historyCollectionParamsSchema),
    validateQuery(historyListQuerySchema),
    asyncRoute(async (req, res) => {
      res.json(await listHistoryPage(
        firebase.db(),
        req.user,
        req.params.collection,
        req.validatedQuery
      ));
    })
  );

  return router;
}

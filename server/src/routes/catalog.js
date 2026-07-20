import { Router } from "express";
import {
  adjustInventoryRecord,
  createMenuItemRecord,
  updateMenuItemRecord
} from "../application/catalog.js";
import {
  inventoryAdjustmentSchema,
  menuItemCreateSchema,
  menuItemUpdateSchema,
  recordIdParams
} from "../contracts/schemas.js";
import { asyncRoute } from "../middleware/errors.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { requireRoles } from "../security.js";

export function createCatalogRouter({ firebase, authentication, realtime }) {
  const router = Router();
  const { authenticate } = authentication;

  router.get("/inventory", authenticate, requireRoles("owner", "staff"), asyncRoute(async (_req, res) => {
    const inventory = (await firebase.db().ref("inventory").once("value")).val() || {};
    res.json({ inventory: Object.fromEntries(Object.entries(inventory).filter(([id]) => !id.startsWith("__"))) });
  }));

  router.patch("/inventory/:itemId", authenticate, requireRoles("owner", "staff"), validateParams(recordIdParams("itemId")), validateBody(inventoryAdjustmentSchema), asyncRoute(async (req, res) => {
    const result = await adjustInventoryRecord(firebase.db(), req.user, req.params.itemId, req.body);
    realtime.emit(["role:owner", "role:staff"], "inventory:updated", result);
    res.json(result);
  }));

  router.patch("/menu/:itemId", authenticate, requireRoles("owner"), validateParams(recordIdParams("itemId")), validateBody(menuItemUpdateSchema), asyncRoute(async (req, res) => {
    const result = await updateMenuItemRecord(firebase.db(), req.user, req.params.itemId, req.body);
    realtime.emit(["role:owner", "role:staff"], "menu:updated", result);
    res.json(result);
  }));

  router.post("/menu", authenticate, requireRoles("owner"), validateBody(menuItemCreateSchema), asyncRoute(async (req, res) => {
    const result = await createMenuItemRecord(firebase.db(), req.user, req.body);
    realtime.emit(["role:owner", "role:staff"], "menu:updated", result);
    res.status(201).json(result);
  }));

  return router;
}

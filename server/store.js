import { createId, createMerchantDefaults, createPublicToken, withTransaction } from './database.js';

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
    demo: Boolean(row.is_demo),
  };
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAddOn(row) {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDish(row, allowedAddOnIds = []) {
  return {
    id: row.id,
    categoryId: row.category_id,
    group: row.category_name,
    name: row.name,
    note: row.note,
    priceCents: row.price_cents,
    active: Boolean(row.active),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    allowedAddOnIds,
  };
}

function mapPlate(row) {
  return {
    id: row.id,
    number: row.number,
    publicToken: row.public_token,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    activeBillId: row.active_bill_id ?? null,
    totalCents: row.total_cents ?? 0,
    itemCount: row.item_count ?? 0,
    completedCount: row.completed_count ?? 0,
    status: row.active_bill_id ? 'active' : 'idle',
  };
}

function mapItem(row, addOns = []) {
  return {
    id: row.id,
    billId: row.bill_id,
    dishId: row.source_dish_id,
    sourceDishId: row.source_dish_id,
    dishGroup: row.category_name_snapshot,
    category: row.dish_name_snapshot,
    dishName: row.dish_name_snapshot,
    dishNote: row.dish_note_snapshot,
    priceCents: row.base_price_cents,
    addOnUnitCents: row.add_on_unit_cents,
    unitTotalCents: row.unit_total_cents,
    quantity: row.quantity,
    totalCents: row.line_total_cents,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    addOns,
    extras: addOns.map((item) => item.name),
  };
}

function mapBill(row, items = []) {
  return {
    id: row.id,
    numberPlateId: row.number_plate_id,
    number: row.number_snapshot,
    status: row.status,
    totalCents: row.total_cents,
    openedAt: row.opened_at,
    settledAt: row.settled_at,
    items,
    itemCount: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    completedCount: items.filter((item) => item.status === 'completed').length,
    incompleteCount: items.filter((item) => item.status !== 'completed').length,
  };
}

export class RestaurantStore {
  constructor(database) {
    this.database = database;
  }

  findUserByNormalized(usernameNormalized) {
    return mapUser(this.database.prepare('SELECT * FROM users WHERE username_normalized = ?').get(usernameNormalized));
  }

  findUserById(id) {
    return mapUser(this.database.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }

  createUser({ id, username, usernameNormalized, passwordHash, passwordSalt, createdAt }) {
    return withTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO users (id, username, username_normalized, password_hash, password_salt, created_at, is_demo)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(id, username, usernameNormalized, passwordHash, passwordSalt, createdAt);
      createMerchantDefaults(this.database, id);
      return this.findUserById(id);
    });
  }

  findSession(tokenHash) {
    const row = this.database.prepare(`
      SELECT s.token_hash, s.user_id, s.created_at, s.expires_at
      FROM sessions s
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, new Date().toISOString());
    if (!row) return null;
    return {
      tokenHash: row.token_hash,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  createSession(session) {
    this.database.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)
    `).run(session.tokenHash, session.userId, session.createdAt, session.expiresAt);
  }

  deleteSession(tokenHash) {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  categories(userId) {
    return this.database.prepare(`
      SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order, created_at, id
    `).all(userId).map(mapCategory);
  }

  addOns(userId) {
    return this.database.prepare(`
      SELECT * FROM add_ons WHERE user_id = ? ORDER BY sort_order, created_at, id
    `).all(userId).map(mapAddOn);
  }

  dishes(userId) {
    const rows = this.database.prepare(`
      SELECT d.*, c.name AS category_name
      FROM dishes d JOIN categories c ON c.id = d.category_id
      WHERE d.user_id = ?
      ORDER BY d.sort_order, d.created_at, d.id
    `).all(userId);
    const relations = this.database.prepare(`
      SELECT da.dish_id, da.add_on_id
      FROM dish_add_ons da JOIN dishes d ON d.id = da.dish_id
      WHERE d.user_id = ? ORDER BY da.sort_order, da.rowid
    `).all(userId);
    const idsByDish = new Map();
    relations.forEach((row) => {
      if (!idsByDish.has(row.dish_id)) idsByDish.set(row.dish_id, []);
      idsByDish.get(row.dish_id).push(row.add_on_id);
    });
    return rows.map((row) => mapDish(row, idsByDish.get(row.id) ?? []));
  }

  numberPlates(userId) {
    return this.database.prepare(`
      SELECT p.*,
        b.id AS active_bill_id,
        COALESCE(b.total_cents, 0) AS total_cents,
        COALESCE(COUNT(i.id), 0) AS item_count,
        COALESCE(SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count
      FROM number_plates p
      LEFT JOIN bills b ON b.number_plate_id = p.id AND b.status = 'open'
      LEFT JOIN bill_items i ON i.bill_id = b.id
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY p.sort_order, p.number
    `).all(userId).map(mapPlate);
  }

  itemsForBills(billIds) {
    if (!billIds.length) return new Map();
    const itemRows = this.database.prepare(`
      SELECT * FROM bill_items WHERE bill_id IN (${placeholders(billIds)}) ORDER BY created_at, id
    `).all(...billIds);
    const itemIds = itemRows.map((row) => row.id);
    const addOns = itemIds.length ? this.database.prepare(`
      SELECT * FROM bill_item_add_ons
      WHERE bill_item_id IN (${placeholders(itemIds)}) ORDER BY sort_order, id
    `).all(...itemIds) : [];
    const addOnsByItem = new Map();
    addOns.forEach((row) => {
      if (!addOnsByItem.has(row.bill_item_id)) addOnsByItem.set(row.bill_item_id, []);
      addOnsByItem.get(row.bill_item_id).push({
        id: row.source_add_on_id,
        name: row.name_snapshot,
        priceCents: row.price_cents,
      });
    });
    const itemsByBill = new Map();
    itemRows.forEach((row) => {
      if (!itemsByBill.has(row.bill_id)) itemsByBill.set(row.bill_id, []);
      itemsByBill.get(row.bill_id).push(mapItem(row, addOnsByItem.get(row.id) ?? []));
    });
    return itemsByBill;
  }

  bills(userId, { status, from, to, limit } = {}) {
    const conditions = ['user_id = ?'];
    const values = [userId];
    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }
    if (Number.isFinite(from)) {
      conditions.push('settled_at >= ?');
      values.push(new Date(from).toISOString());
    }
    if (Number.isFinite(to)) {
      conditions.push('settled_at < ?');
      values.push(new Date(to).toISOString());
    }
    let sql = `SELECT * FROM bills WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(settled_at, opened_at) DESC, id DESC`;
    if (Number.isInteger(limit) && limit > 0) {
      sql += ' LIMIT ?';
      values.push(limit);
    }
    const rows = this.database.prepare(sql).all(...values);
    const itemsByBill = this.itemsForBills(rows.map((row) => row.id));
    return rows.map((row) => mapBill(row, itemsByBill.get(row.id) ?? []));
  }

  bill(userId, billId) {
    const row = this.database.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(billId, userId);
    if (!row) return null;
    return mapBill(row, this.itemsForBills([row.id]).get(row.id) ?? []);
  }

  state(userId) {
    const categories = this.categories(userId);
    const dishes = this.dishes(userId);
    const addOns = this.addOns(userId);
    const numberPlates = this.numberPlates(userId);
    const openBills = this.bills(userId, { status: 'open' });
    const numberByBill = new Map(openBills.map((bill) => [bill.id, bill.number]));
    const queue = openBills.flatMap((bill) => bill.items)
      .filter((item) => item.status !== 'completed')
      .map((item) => ({ ...item, number: numberByBill.get(item.billId) }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const settingsRow = this.database.prepare(`
      SELECT sound_enabled, payment_qr_blob IS NOT NULL AS payment_qr_configured
      FROM merchant_settings WHERE user_id = ?
    `).get(userId);
    return {
      categories,
      dishes,
      addOns,
      numberPlates,
      openBills,
      queue,
      settings: {
        sound: Boolean(settingsRow?.sound_enabled),
        paymentQrConfigured: Boolean(settingsRow?.payment_qr_configured),
        availableNumbers: numberPlates.map((plate) => plate.number),
      },
    };
  }

  createBillItem(userId, { numberPlateId, dishId, addOnIds, quantity }) {
    const timestamp = new Date().toISOString();
    return withTransaction(this.database, () => {
      const plate = this.database.prepare(`
        SELECT * FROM number_plates WHERE id = ? AND user_id = ?
      `).get(numberPlateId, userId);
      if (!plate) throw Object.assign(new Error('号牌不存在或未启用。'), { status: 404 });

      const dish = this.database.prepare(`
        SELECT d.*, c.name AS category_name FROM dishes d
        JOIN categories c ON c.id = d.category_id
        WHERE d.id = ? AND d.user_id = ? AND d.active = 1
      `).get(dishId, userId);
      if (!dish) throw Object.assign(new Error('该菜品已停用或删除，请重新选择。'), { status: 409 });

      const uniqueAddOnIds = [...new Set(addOnIds)];
      const selectedAddOns = uniqueAddOnIds.length ? this.database.prepare(`
        SELECT a.* FROM add_ons a
        JOIN dish_add_ons da ON da.add_on_id = a.id
        WHERE da.dish_id = ? AND a.user_id = ? AND a.active = 1
          AND a.id IN (${placeholders(uniqueAddOnIds)})
        ORDER BY da.sort_order, a.id
      `).all(dishId, userId, ...uniqueAddOnIds) : [];
      if (selectedAddOns.length !== uniqueAddOnIds.length) {
        throw Object.assign(new Error('部分小料不可用于该菜品，请重新选择。'), { status: 409 });
      }

      let bill = this.database.prepare(`
        SELECT * FROM bills WHERE user_id = ? AND number_plate_id = ? AND status = 'open'
      `).get(userId, numberPlateId);
      if (!bill) {
        const billId = createId('bill');
        this.database.prepare(`
          INSERT INTO bills (id, user_id, number_plate_id, number_snapshot, status, total_cents, opened_at)
          VALUES (?, ?, ?, ?, 'open', 0, ?)
        `).run(billId, userId, numberPlateId, plate.number, timestamp);
        bill = this.database.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
      }

      const addOnUnitCents = selectedAddOns.reduce((sum, item) => sum + item.price_cents, 0);
      const unitTotalCents = dish.price_cents + addOnUnitCents;
      const lineTotalCents = unitTotalCents * quantity;
      const itemId = createId('item');
      this.database.prepare(`
        INSERT INTO bill_items (
          id, bill_id, user_id, source_dish_id, category_name_snapshot, dish_name_snapshot,
          dish_note_snapshot, base_price_cents, add_on_unit_cents, unit_total_cents,
          quantity, line_total_cents, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)
      `).run(
        itemId,
        bill.id,
        userId,
        dish.id,
        dish.category_name,
        dish.name,
        dish.note,
        dish.price_cents,
        addOnUnitCents,
        unitTotalCents,
        quantity,
        lineTotalCents,
        timestamp,
      );
      const insertSnapshot = this.database.prepare(`
        INSERT INTO bill_item_add_ons (id, bill_item_id, source_add_on_id, name_snapshot, price_cents, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      selectedAddOns.forEach((item, sortOrder) => {
        insertSnapshot.run(createId('item-addon'), itemId, item.id, item.name, item.price_cents, sortOrder);
      });
      this.database.prepare('UPDATE bills SET total_cents = total_cents + ? WHERE id = ?').run(lineTotalCents, bill.id);
      return { billId: bill.id, itemId, numberPlateId };
    });
  }

  updateTask(userId, taskId, action) {
    const targetStatus = action === 'start' ? 'making' : action === 'complete' ? 'completed' : null;
    const sourceStatus = action === 'start' ? 'waiting' : action === 'complete' ? 'making' : null;
    if (!targetStatus) throw Object.assign(new Error('不支持的出餐操作。'), { status: 400 });
    const timestamp = new Date().toISOString();
    const timeColumn = action === 'start' ? 'started_at' : 'completed_at';
    const result = this.database.prepare(`
      UPDATE bill_items SET status = ?, ${timeColumn} = ?
      WHERE id = ? AND user_id = ? AND status = ?
    `).run(targetStatus, timestamp, taskId, userId, sourceStatus);
    if (!result.changes) {
      const current = this.database.prepare('SELECT status FROM bill_items WHERE id = ? AND user_id = ?').get(taskId, userId);
      if (!current) throw Object.assign(new Error('菜品任务不存在。'), { status: 404 });
      throw Object.assign(new Error(`任务当前状态为${current.status}，请刷新后重试。`), { status: 409 });
    }
    const row = this.database.prepare(`
      SELECT i.*, b.number_plate_id FROM bill_items i JOIN bills b ON b.id = i.bill_id WHERE i.id = ?
    `).get(taskId);
    return { taskId, status: targetStatus, numberPlateId: row.number_plate_id };
  }

  batchUpdateTasks(userId, sourceDishId, action) {
    const targetStatus = action === 'start' ? 'making' : action === 'complete' ? 'completed' : null;
    const sourceStatus = action === 'start' ? 'waiting' : action === 'complete' ? 'making' : null;
    if (!targetStatus) throw Object.assign(new Error('不支持的批量出餐操作。'), { status: 400 });
    const plateRows = this.database.prepare(`
      SELECT DISTINCT b.number_plate_id FROM bill_items i JOIN bills b ON b.id = i.bill_id
      WHERE i.user_id = ? AND i.source_dish_id = ? AND i.status = ?
    `).all(userId, sourceDishId, sourceStatus);
    const timestamp = new Date().toISOString();
    const timeColumn = action === 'start' ? 'started_at' : 'completed_at';
    const result = this.database.prepare(`
      UPDATE bill_items SET status = ?, ${timeColumn} = ?
      WHERE user_id = ? AND source_dish_id = ? AND status = ?
    `).run(targetStatus, timestamp, userId, sourceDishId, sourceStatus);
    return { updated: result.changes, numberPlateIds: plateRows.map((row) => row.number_plate_id).filter(Boolean) };
  }

  settleBill(userId, billId) {
    return withTransaction(this.database, () => {
      const bill = this.database.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(billId, userId);
      if (!bill) throw Object.assign(new Error('账单不存在。'), { status: 404 });
      if (bill.status === 'settled') return { billId, numberPlateId: bill.number_plate_id, alreadySettled: true };
      const incomplete = Number(this.database.prepare(`
        SELECT COUNT(*) AS count FROM bill_items WHERE bill_id = ? AND status != 'completed'
      `).get(billId).count);
      if (incomplete > 0) {
        throw Object.assign(new Error(`还有 ${incomplete} 道菜未完成，暂不能结算。`), { status: 409, incomplete });
      }
      const totalCents = Number(this.database.prepare(`
        SELECT COALESCE(SUM(line_total_cents), 0) AS total FROM bill_items WHERE bill_id = ?
      `).get(billId).total);
      const settledAt = new Date().toISOString();
      this.database.prepare(`
        UPDATE bills SET status = 'settled', total_cents = ?, settled_at = ?
        WHERE id = ? AND user_id = ? AND status = 'open'
      `).run(totalCents, settledAt, billId, userId);
      return { billId, numberPlateId: bill.number_plate_id, totalCents, settledAt, alreadySettled: false };
    });
  }

  plateByToken(token) {
    return this.database.prepare('SELECT * FROM number_plates WHERE public_token = ?').get(token) ?? null;
  }

  publicProgress(token) {
    const plate = this.plateByToken(token);
    if (!plate) return null;
    const billRow = this.database.prepare(`
      SELECT * FROM bills WHERE user_id = ? AND number_plate_id = ? AND status = 'open'
    `).get(plate.user_id, plate.id);
    const settings = this.database.prepare(`
      SELECT payment_qr_blob IS NOT NULL AS configured FROM merchant_settings WHERE user_id = ?
    `).get(plate.user_id);
    if (!billRow) {
      return { numberPlateId: plate.id, number: plate.number, bill: null, paymentQrConfigured: Boolean(settings?.configured) };
    }
    const bill = mapBill(billRow, this.itemsForBills([billRow.id]).get(billRow.id) ?? []);
    const items = bill.items.map((item) => {
      if (item.status !== 'waiting') return { ...item, queuePosition: null, aheadCount: null };
      const aheadCount = Number(this.database.prepare(`
        SELECT COUNT(*) AS count FROM bill_items
        WHERE user_id = ? AND source_dish_id = ? AND status = 'waiting'
          AND (created_at < ? OR (created_at = ? AND id < ?))
      `).get(plate.user_id, item.sourceDishId, item.createdAt, item.createdAt, item.id).count);
      return { ...item, queuePosition: aheadCount + 1, aheadCount };
    });
    return {
      numberPlateId: plate.id,
      number: plate.number,
      paymentQrConfigured: Boolean(settings?.configured),
      bill: { ...bill, items },
    };
  }

  paymentQrForUser(userId) {
    return this.database.prepare(`
      SELECT payment_qr_blob AS data, payment_qr_mime AS mime FROM merchant_settings WHERE user_id = ?
    `).get(userId) ?? null;
  }

  paymentQrForToken(token) {
    return this.database.prepare(`
      SELECT s.payment_qr_blob AS data, s.payment_qr_mime AS mime
      FROM number_plates p JOIN merchant_settings s ON s.user_id = p.user_id
      WHERE p.public_token = ?
    `).get(token) ?? null;
  }

  createPlate(userId, number, sortOrder) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const id = createId('plate');
        const token = createPublicToken();
        this.database.prepare(`
          INSERT INTO number_plates (id, user_id, number, public_token, sort_order, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, userId, number, token, sortOrder, new Date().toISOString());
        return mapPlate(this.database.prepare('SELECT * FROM number_plates WHERE id = ?').get(id));
      } catch (error) {
        if (!String(error.message).includes('public_token')) throw error;
      }
    }
    throw new Error('无法生成唯一号牌令牌。');
  }
}

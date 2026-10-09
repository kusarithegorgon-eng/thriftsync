import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const port = Number(process.env.API_PORT || 4000);
const tokenSecret = process.env.AUTH_TOKEN_SECRET;
const uploadsDirectory = path.join(root, 'uploads');
const jsonColumns = new Set(['images', 'image_metadata', 'stops', 'metadata', 'channels', 'operating_hours']);
const allowedTables = new Set([
  'profiles', 'boutiques', 'listings', 'bids', 'orders', 'messages', 'wishlists', 'reviews',
  'cebu_districts', 'cebu_barangays', 'itineraries', 'locker_locations', 'locker_handoffs',
  'vouchers', 'voucher_redemptions', 'trade_offers', 'trade_items', 'trade_events',
  'trade_inventory_locks', 'trade_shipments',
]);

if (!tokenSecret || tokenSecret.length < 32 || tokenSecret.startsWith('replace-this-')) {
  console.error('AUTH_TOKEN_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'thrifysync',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDirectory, { fallthrough: false, index: false }));

const quote = (identifier) => `\`${identifier.replaceAll('`', '``')}\``;
const httpError = (status, message) => Object.assign(new Error(message), { status });

function jsonSafe(row) {
  if (!row) return row;
  for (const key of jsonColumns) {
    if (typeof row[key] === 'string') {
      try {
        row[key] = JSON.parse(row[key]);
      } catch {
        throw new Error(`Invalid JSON stored in database column "${key}".`);
      }
    }
  }
  return row;
}

function signToken(userId, email) {
  const body = Buffer.from(JSON.stringify({
    sub: userId,
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readToken(token) {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', tokenSecret).update(body).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.exp <= Date.now() / 1000) return null;
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

async function loadUser(req, _res, next) {
  const bearer = req.get('x-application-token') || req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  req.user = readToken(bearer);
  if (req.user) {
    const [rows] = await pool.execute(
      'SELECT p.id, p.role, p.display_name FROM profiles p JOIN app_users u ON u.id = p.id WHERE p.id = ? AND u.email = ?',
      [req.user.id, req.user.email],
    );
    req.profile = rows[0] || null;
  }
  next();
}

app.use('/api', async (req, res, next) => {
  try {
    await loadUser(req, res, next);
  } catch (error) {
    next(error);
  }
});

function requireUser(req) {
  if (!req.user || !req.profile) throw httpError(401, 'Sign in to continue.');
  return req.profile;
}

function requireAdmin(req) {
  const profile = requireUser(req);
  if (profile.role !== 'admin') throw httpError(403, 'Administrator access required.');
  return profile;
}

function ensureTable(table) {
  if (!allowedTables.has(table)) throw httpError(400, 'Unknown database table.');
}

function parseOrExpression(expression, columns) {
  if (typeof expression !== 'string' || expression.length > 1000) throw httpError(400, 'Invalid filter.');
  const clauses = expression.split(',');
  const sql = [];
  const params = [];
  for (const clause of clauses) {
    const match = clause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.(eq|ilike)\.(.*)$/);
    if (!match || !columns.has(match[1])) throw httpError(400, 'Unsupported filter expression.');
    const [, column, operator, value] = match;
    if (operator === 'ilike') {
      sql.push(`LOWER(${quote(column)}) LIKE LOWER(?)`);
      params.push(value.replaceAll('*', '%'));
    } else {
      sql.push(`${quote(column)} = ?`);
      params.push(value);
    }
  }
  if (!sql.length) throw httpError(400, 'Empty filter expression.');
  return { sql: `(${sql.join(' OR ')})`, params };
}

function makeWhere(filters, columns) {
  const clauses = [];
  const params = [];
  for (const filter of filters) {
    if (filter.column === '$or' && filter.operator === 'or') {
      const result = parseOrExpression(filter.value, columns);
      clauses.push(result.sql);
      params.push(...result.params);
      continue;
    }
    if (typeof filter.column !== 'string' || !columns.has(filter.column)) throw httpError(400, 'Unknown filter column.');
    if (filter.operator === 'in') {
      if (!Array.isArray(filter.value)) throw httpError(400, 'Invalid IN filter.');
      if (filter.value.length === 0) clauses.push('1 = 0');
      else {
        clauses.push(`${quote(filter.column)} IN (${filter.value.map(() => '?').join(', ')})`);
        params.push(...filter.value);
      }
    } else if (filter.operator === 'eq' || filter.operator === 'neq') {
      clauses.push(`${quote(filter.column)} ${filter.operator === 'eq' ? '<=>' : '<>'} ?`);
      params.push(filter.value);
    } else if (filter.operator === 'not.is' && filter.value === null) {
      clauses.push(`${quote(filter.column)} IS NOT NULL`);
    } else if (filter.operator === 'is' && filter.value === null) {
      clauses.push(`${quote(filter.column)} IS NULL`);
    } else {
      throw httpError(400, 'Unsupported filter operator.');
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

const relations = {
  listings: {
    boutiques: { foreignKey: 'boutique_id', parentKey: 'id' },
  },
  wishlists: {
    listings: { foreignKey: 'listing_id', parentKey: 'id' },
  },
  orders: {
    listings: { foreignKey: 'listing_id', parentKey: 'id' },
    boutiques: { foreignKey: 'boutique_id', parentKey: 'id' },
  },
};

function splitSelection(selection) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selection.length; index += 1) {
    if (selection[index] === '(') depth += 1;
    else if (selection[index] === ')') depth -= 1;
    else if (selection[index] === ',' && depth === 0) {
      parts.push(selection.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw httpError(400, 'Invalid column selection.');
  }
  if (depth !== 0) throw httpError(400, 'Invalid column selection.');
  parts.push(selection.slice(start).trim());
  return parts.filter(Boolean);
}

function parseRequestedRelations(selection, table) {
  return splitSelection(selection).flatMap((part) => {
    const match = part.match(/^([a-z_]+)\s*\((.*)\)$/s);
    if (!match) return [];
    const [, name, fields] = match;
    const relation = relations[table]?.[name];
    if (!relation || !allowedTables.has(name)) throw httpError(400, `Unsupported relation "${name}".`);
    return [{ name, fields: fields.trim() || '*', ...relation }];
  });
}

async function attachRelations(table, rows, selection) {
  if (!rows.length) return rows;
  const nested = parseRequestedRelations(selection, table);
  for (const relation of nested) {
    const keys = [...new Set(rows.map((row) => row[relation.foreignKey]).filter(Boolean))];
    if (keys.length === 0) {
      rows.forEach((row) => { row[relation.name] = null; });
      continue;
    }
    const [relatedRows] = await pool.query(
      `SELECT * FROM ${quote(relation.name)} WHERE ${quote(relation.parentKey)} IN (${keys.map(() => '?').join(', ')})`,
      keys,
    );
    const relatedById = new Map(relatedRows.map((row) => [row[relation.parentKey], jsonSafe(row)]));
    const children = await attachRelations(relation.name, [...relatedById.values()], relation.fields);
    for (const child of children) relatedById.set(child[relation.parentKey], child);
    rows.forEach((row) => {
      row[relation.name] = relatedById.get(row[relation.foreignKey]) || null;
    });
  }
  return rows;
}

async function requireReadAccess(req, table, row) {
  const user = req.user?.id;
  const role = req.profile?.role;
  const publicTables = new Set(['profiles', 'boutiques', 'listings', 'bids', 'reviews', 'cebu_districts', 'cebu_barangays', 'locker_locations', 'vouchers']);
  if (publicTables.has(table) &&
    (table !== 'listings' || row.status === 'active' || row.status === 'sold' || role === 'admin') &&
    (table !== 'vouchers' || row.status === 'ACTIVE')) return;
  if (!user) throw httpError(401, 'Sign in to view this data.');
  if (role === 'admin') return;
  if (table === 'listings') {
    if (await isBoutiqueSeller(user, row.boutique_id)) return;
    throw httpError(403, 'You are not allowed to view this listing.');
  }
  if (table === 'vouchers' && row.boutique_id) {
    if (await isBoutiqueSeller(user, row.boutique_id)) return;
    if (row.status !== 'ACTIVE') throw httpError(403, 'You are not allowed to view this voucher.');
    return;
  }
  if (table === 'voucher_redemptions') {
    const [vouchers] = await pool.execute('SELECT created_by, boutique_id FROM vouchers WHERE id = ?', [row.voucher_id]);
    const voucher = vouchers[0];
    if (row.user_id === user || voucher?.created_by === user ||
      (voucher?.boutique_id && await isBoutiqueSeller(user, voucher.boutique_id))) return;
    throw httpError(403, 'You are not allowed to view this redemption.');
  }
  if (table === 'trade_items' || table === 'trade_events' || table === 'trade_inventory_locks') {
    const [offers] = await pool.execute('SELECT initiator_id, recipient_id FROM trade_offers WHERE id = ?', [row.trade_offer_id]);
    if (offers[0]?.initiator_id === user || offers[0]?.recipient_id === user) return;
    throw httpError(403, 'You are not a participant in this trade.');
  }

  const allowed = {
    wishlists: row.user_id === user,
    itineraries: row.user_id === user,
    locker_handoffs: row.user_id === user,
    orders: row.buyer_id === user || row.seller_id === user,
    messages: row.sender_id === user || row.receiver_id === user,
    voucher_redemptions: row.user_id === user,
    vouchers: row.status === 'ACTIVE' || row.owner_id === user || row.created_by === user,
    trade_offers: row.initiator_id === user || row.recipient_id === user,
    trade_shipments: row.sender_id === user || row.recipient_id === user,
  };
  if (allowed[table] !== true) throw httpError(403, 'You are not allowed to view this data.');
}

async function canManageVoucher(req, row) {
  const profile = requireUser(req);
  if (profile.role === 'admin') return true;
  if (!row.boutique_id) return false;
  const [rows] = await pool.execute('SELECT seller_id FROM boutiques WHERE id = ?', [row.boutique_id]);
  return rows[0]?.seller_id === profile.id;
}

async function canWrite(req, table, operation, row) {
  const profile = requireUser(req);
  if (profile.role === 'admin') return;

  switch (table) {
    case 'profiles':
      if (row.id !== profile.id || (operation !== 'update' && operation !== 'select')) break;
      return;
    case 'boutiques':
      if (profile.role !== 'seller' || row.seller_id !== profile.id) break;
      return;
    case 'listings': {
      const boutiqueId = row.boutique_id;
      const [rows] = await pool.execute('SELECT seller_id FROM boutiques WHERE id = ?', [boutiqueId]);
      if (rows[0]?.seller_id === profile.id) return;
      break;
    }
    case 'bids':
      if (row.bidder_id !== profile.id) break;
      return;
    case 'orders':
      if (row.buyer_id === profile.id && operation === 'insert') return;
      if (await isBoutiqueSeller(profile.id, row.boutique_id)) return;
      break;
    case 'messages':
      if (row.sender_id === profile.id && operation === 'insert') return;
      break;
    case 'wishlists':
    case 'itineraries':
    case 'locker_handoffs':
      if (table === 'wishlists' && operation === 'update') break;
      if (table === 'locker_handoffs' && operation === 'update' &&
        ['user_id', 'locker_location_id', 'pin_code', 'status', 'capacity_available'].some((key) => key in row)) {
        throw httpError(403, 'Locker handoff state is managed by the server.');
      }
      if ((row.user_id === profile.id || table === 'locker_handoffs' && row.user_id === profile.id)) return;
      break;
    case 'reviews':
      if (row.reviewer_id === profile.id && operation === 'insert') return;
      break;
    case 'vouchers':
      if (await canManageVoucher(req, row)) return;
      break;
    case 'voucher_redemptions':
      if (row.user_id === profile.id && operation === 'insert') return;
      break;
    case 'trade_offers':
      if (row.initiator_id === profile.id) return;
      break;
    case 'trade_items':
    case 'trade_events':
    case 'trade_inventory_locks':
    case 'trade_shipments':
      break;
    default:
      break;
  }
  throw httpError(403, `You are not allowed to ${operation} ${table}.`);
}

async function isBoutiqueSeller(userId, boutiqueId) {
  const [rows] = await pool.execute('SELECT 1 FROM boutiques WHERE id = ? AND seller_id = ?', [boutiqueId, userId]);
  return rows.length > 0;
}

async function getTableColumns(table) {
  const [rows] = await pool.execute(
    'SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_KEY AS columnKey FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  );
  if (!rows.length) throw httpError(500, `Table "${table}" is missing. Import database/thrifysync.sql first.`);
  return new Map(rows.map((row) => [row.name, row]));
}

function normalizeValues(values, columns) {
  const objects = Array.isArray(values) ? values : [values];
  if (!objects.length || objects.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw httpError(400, 'Provide a record or a list of records.');
  }
  return objects.map((object) => {
    const row = { ...object };
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) throw httpError(400, `Unknown database column "${key}".`);
      if (jsonColumns.has(key) && row[key] !== null && typeof row[key] !== 'string') row[key] = JSON.stringify(row[key]);
    }
    if (columns.has('id') && !row.id) row.id = crypto.randomUUID();
    return row;
  });
}

app.post('/api/data', async (req, res, next) => {
  try {
    const { table, operation = 'select', columns = '*', values, filters = [], order = [], limit } = req.body;
    ensureTable(table);
    if (!['select', 'insert', 'update', 'delete'].includes(operation)) throw httpError(400, 'Unsupported database operation.');
    const definitions = await getTableColumns(table);
    const validColumns = new Set(definitions.keys());
    const where = makeWhere(filters, validColumns);

    if (operation === 'select') {
      if (typeof columns !== 'string' || columns.length > 4000) throw httpError(400, 'Invalid selection.');
      const userScopedTables = new Set([
        'wishlists', 'itineraries', 'locker_handoffs', 'orders', 'messages',
        'voucher_redemptions', 'trade_offers', 'trade_items', 'trade_events',
        'trade_inventory_locks', 'trade_shipments',
      ]);
      if (userScopedTables.has(table)) requireUser(req);
      const orderSql = order.map((item) => {
        if (!validColumns.has(item.column)) throw httpError(400, 'Unknown sort column.');
        return `${quote(item.column)} ${item.ascending ? 'ASC' : 'DESC'}`;
      });
      const rowLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000);
      const [rawRows] = await pool.execute(
        `SELECT * FROM ${quote(table)}${where.sql}${orderSql.length ? ` ORDER BY ${orderSql.join(', ')}` : ''} LIMIT ${rowLimit}`,
        where.params,
      );
      let rows = rawRows.map(jsonSafe);
      for (const row of rows) {
        if (table === 'orders') {
          const [shops] = await pool.execute('SELECT seller_id FROM boutiques WHERE id = ?', [row.boutique_id]);
          row.seller_id = shops[0]?.seller_id;
        }
        await requireReadAccess(req, table, row);
      }
      rows = await attachRelations(table, rows, String(columns));
      return res.json({ data: rows });
    }

    requireUser(req);
    if (operation === 'insert') {
      const rows = normalizeValues(values, definitions);
      for (const row of rows) await canWrite(req, table, operation, row);
      const keys = Object.keys(rows[0]);
      const [result] = await pool.execute(
        `INSERT INTO ${quote(table)} (${keys.map(quote).join(', ')}) VALUES ${rows.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ')}`,
        rows.flatMap((row) => keys.map((key) => row[key] ?? null)),
      );
      const ids = rows.map((row) => row.id).filter(Boolean);
      const data = ids.length
        ? (await pool.execute(`SELECT * FROM ${quote(table)} WHERE ${quote('id')} IN (${ids.map(() => '?').join(', ')})`, ids))[0].map(jsonSafe)
        : [];
      return res.json({ data: Array.isArray(values) ? data : data[0] || { affectedRows: result.affectedRows } });
    }

    const [existing] = await pool.execute(`SELECT * FROM ${quote(table)}${where.sql}`, where.params);
    if (!existing.length && operation === 'update') return res.json({ data: [] });
    if (operation === 'update') {
      const updateKeys = Object.keys(values || {});
      const protectedColumns = {
        profiles: ['role'],
        listings: ['moderation_status', 'moderation_note', 'moderated_by', 'moderated_at'],
        orders: ['buyer_id', 'listing_id', 'boutique_id', 'amount'],
        bids: ['listing_id', 'bidder_id', 'is_winning', 'amount'],
        messages: ['sender_id', 'receiver_id', 'listing_id'],
      }[table] || [];
      if (updateKeys.some((key) => protectedColumns.includes(key))) {
        throw httpError(403, 'One or more requested fields are server-managed.');
      }
    }
    for (const row of existing) {
      if (table === 'orders') {
        const [shops] = await pool.execute('SELECT seller_id FROM boutiques WHERE id = ?', [row.boutique_id]);
        row.seller_id = shops[0]?.seller_id;
      }
      await requireReadAccess(req, table, row);
      await canWrite(req, table, operation, { ...row, ...(values || {}) });
    }
    if (operation === 'delete') {
      const [result] = await pool.execute(`DELETE FROM ${quote(table)}${where.sql}`, where.params);
      return res.json({ data: { affectedRows: result.affectedRows } });
    }
    const updateValues = normalizeValues(values, definitions)[0];
    delete updateValues.id;
    const setColumns = Object.keys(updateValues);
    if (!setColumns.length) throw httpError(400, 'No update values supplied.');
    const [result] = await pool.execute(
      `UPDATE ${quote(table)} SET ${setColumns.map((key) => `${quote(key)} = ?`).join(', ')}${where.sql}`,
      [...setColumns.map((key) => updateValues[key] ?? null), ...where.params],
    );
    return res.json({ data: { affectedRows: result.affectedRows } });
  } catch (error) {
    next(error);
  }
});

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

async function createSession(email, password, { mode, displayName = '', role = 'buyer' }) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw httpError(400, 'Password must be between 8 and 128 characters.');

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const normalizedEmail = email.trim().toLowerCase();
    const [existing] = await connection.execute('SELECT id, password_salt, password_hash FROM app_users WHERE email = ? FOR UPDATE', [normalizedEmail]);
    let userId;
    if (existing.length) {
      if (mode === 'sign-up') throw httpError(409, 'An account with this email already exists.');
      const stored = existing[0];
      const { hash } = hashPassword(password, stored.password_salt);
      const actual = Buffer.from(hash, 'hex');
      const expected = Buffer.from(stored.password_hash, 'hex');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw httpError(401, 'Incorrect email or password.');
      userId = stored.id;
    } else {
      if (mode === 'sign-in') throw httpError(401, 'Incorrect email or password.');
      userId = crypto.randomUUID();
      const { salt, hash } = hashPassword(password);
      await connection.execute(
        'INSERT INTO profiles (id, role, display_name) VALUES (?, ?, ?)',
        [userId, role, displayName],
      );
      await connection.execute('INSERT INTO app_users (id, email, password_salt, password_hash) VALUES (?, ?, ?, ?)', [userId, normalizedEmail, salt, hash]);
    }
    const [profiles] = await connection.execute('SELECT role, display_name FROM profiles WHERE id = ?', [userId]);
    if (!profiles.length) throw httpError(500, 'Account profile was not created.');
    await connection.commit();
    const user = { id: userId, email: normalizedEmail };
    return { user, session: { user, access_token: signToken(userId, normalizedEmail) } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

app.post('/api/auth/sign-up', async (req, res, next) => {
  try {
    const { email, password, options } = req.body;
    const displayName = String(options?.data?.display_name || '').trim().slice(0, 255);
    const role = options?.data?.role === 'seller' ? 'seller' : 'buyer';
    res.json(await createSession(email, password, { mode: 'sign-up', displayName, role }));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/sign-in', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    res.json(await createSession(email, password, { mode: 'sign-in' }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/session', async (req, res, next) => {
  try {
    const profile = requireUser(req);
    res.json({ session: { user: req.user, access_token: getBearer(req), profile } });
  } catch (error) {
    next(error);
  }
});

function getBearer(req) {
  return req.get('authorization')?.replace(/^Bearer /i, '') || '';
}

app.post('/api/rpc/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const args = req.body || {};
    const profile = requireUser(req);
    if (name === 'approve_listing' || name === 'reject_listing') {
      requireAdmin(req);
      const isApprove = name === 'approve_listing';
      const moderationStatus = isApprove ? 'approved' : 'rejected';
      const status = isApprove ? 'active' : 'draft';
      const note = args.p_note ?? args.p_reason ?? null;
      const [result] = await pool.execute(
        'UPDATE listings SET moderation_status = ?, moderation_note = ?, moderated_by = ?, moderated_at = NOW(), status = ? WHERE id = ?',
        [moderationStatus, note, profile.id, status, args.p_listing_id],
      );
      const data = [{ success: result.affectedRows > 0, message: result.affectedRows ? (isApprove ? 'Listing approved and is now live' : 'Listing rejected with reason provided') : 'Listing not found' }];
      return res.json({ data });
    }
    if (name === 'validate_voucher') {
      const code = String(args.p_code || '').trim();
      const [rows] = await pool.execute('SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?) AND status = "ACTIVE" LIMIT 1', [code]);
      const voucher = rows[0];
      let message = 'Valid';
      let valid = Boolean(voucher);
      const cartTotal = Number(args.p_cart_total || 0);
      if (!voucher) message = 'Invalid or inactive code';
      else if (voucher.expires_at && new Date(voucher.expires_at) <= new Date()) { valid = false; message = 'This code has expired'; }
      else if (voucher.max_uses !== null && voucher.uses >= voucher.max_uses) { valid = false; message = 'Usage limit reached'; }
      else if (voucher.min_spend > cartTotal) { valid = false; message = `Minimum spend of $${voucher.min_spend} required`; }
      else if (args.p_has_auction_items && !voucher.auction_eligible) { valid = false; message = 'Auction items are not eligible for this code'; }
      else if (voucher.scope === 'BOUTIQUE' && args.p_boutique_ids && !args.p_boutique_ids.includes(voucher.boutique_id)) { valid = false; message = 'This code is not valid for the items in your cart'; }
      else if (voucher.scope === 'CATEGORY' && args.p_categories && !args.p_categories.includes(voucher.category)) { valid = false; message = 'This code is not valid for the categories in your cart'; }
      const discount = !valid ? 0 : voucher.discount_type === 'PERCENTAGE'
        ? cartTotal * Number(voucher.discount_value) / 100
        : Math.min(Number(voucher.discount_value), cartTotal);
      return res.json({ data: [{ valid, code: valid ? voucher.code : null, discount_type: valid ? voucher.discount_type : null, discount_value: valid ? Number(voucher.discount_value) : 0, discount_amount: discount, scope: valid ? voucher.scope : null, message }] });
    }
    if (name === 'redeem_voucher') {
      if (args.p_user_id !== profile.id) throw httpError(403, 'Cannot redeem a voucher for another user.');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [vouchers] = await connection.execute('SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?) FOR UPDATE', [String(args.p_code || '')]);
        const voucher = vouchers[0];
        if (!voucher || voucher.status !== 'ACTIVE' || voucher.expires_at && new Date(voucher.expires_at) <= new Date()) throw httpError(400, 'Voucher is invalid or expired.');
        if (voucher.max_uses !== null && voucher.uses >= voucher.max_uses) throw httpError(400, 'Voucher usage limit reached.');
        const [usageRows] = await connection.execute('SELECT COUNT(*) AS uses FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?', [voucher.id, profile.id]);
        if (usageRows[0].uses >= voucher.max_uses_per_user) throw httpError(400, 'You have already used this code.');
        const cartTotal = Number(args.p_cart_total || 0);
        const discount = voucher.discount_type === 'PERCENTAGE' ? cartTotal * Number(voucher.discount_value) / 100 : Math.min(Number(voucher.discount_value), cartTotal);
        await connection.execute('UPDATE vouchers SET uses = uses + 1 WHERE id = ?', [voucher.id]);
        await connection.execute(
          'INSERT INTO voucher_redemptions (id, voucher_id, user_id, order_id, cart_total_at_redemption, discount_amount) VALUES (?, ?, ?, ?, ?, ?)',
          [crypto.randomUUID(), voucher.id, profile.id, args.p_order_id || null, cartTotal, discount],
        );
        await connection.commit();
        return res.json({ data: [{ voucher_id: voucher.id, code: voucher.code, discount_amount: discount, message: 'Success' }] });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    if (name === 'generate_handoff_pin') {
      const lockerId = args.p_locker_location_id;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [locations] = await connection.execute('SELECT * FROM locker_locations WHERE id = ? AND is_active = 1 FOR UPDATE', [lockerId]);
        const locker = locations[0];
        if (!locker || locker.capacity_available <= 0) throw httpError(400, 'Locker is unavailable or full.');
        const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const handoffId = crypto.randomUUID();
        const expiry = new Date(Date.now() + Math.max(1, Math.min(Number(args.p_window_hours) || 48, 168)) * 60 * 60 * 1000);
        await connection.execute(
          'INSERT INTO locker_handoffs (id, locker_location_id, order_id, user_id, pin_code, status, drop_off_window_start, drop_off_window_end) VALUES (?, ?, ?, ?, ?, "PENDING", NOW(), ?)',
          [handoffId, lockerId, args.p_order_id || null, profile.id, pin, expiry],
        );
        const [updated] = await connection.execute('UPDATE locker_locations SET capacity_available = capacity_available - 1 WHERE id = ? AND capacity_available > 0', [lockerId]);
        if (!updated.affectedRows) throw httpError(409, 'No locker compartments remain.');
        await connection.commit();
        return res.json({ data: [{ handoff_id: handoffId, pin_code: pin, locker_name: locker.partner_name, expires_at: expiry.toISOString() }] });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    if (name === 'confirm_handoff_pickup') {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT * FROM locker_handoffs WHERE id = ? FOR UPDATE', [args.p_handoff_id]);
        const handoff = rows[0];
        let success = Boolean(handoff && handoff.user_id === profile.id && handoff.pin_code === args.p_pin_code && ['PENDING', 'DROPPED_OFF'].includes(handoff.status));
        let message = !handoff ? 'Handoff record not found' : handoff.user_id !== profile.id ? 'Not authorized to confirm this handoff' : handoff.pin_code !== args.p_pin_code ? 'Invalid PIN code' : !['PENDING', 'DROPPED_OFF'].includes(handoff.status) ? 'Handoff is not ready for pickup' : 'Pickup confirmed successfully';
        if (success) {
          await connection.execute('UPDATE locker_handoffs SET status = "PICKED_UP", picked_up_at = NOW() WHERE id = ?', [handoff.id]);
          await connection.execute('UPDATE locker_locations SET capacity_available = LEAST(capacity_total, capacity_available + 1) WHERE id = ?', [handoff.locker_location_id]);
        }
        await connection.commit();
        return res.json({ data: [{ success, message }] });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    throw httpError(404, `Unknown database function "${name}".`);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auction-ops', async (req, res, next) => {
  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    const profile = requireUser(req);
    const { action, listing_id: listingId, bid_amount: bidAmount } = req.body;
    await connection.beginTransaction();
    transactionStarted = true;
    const [listings] = await connection.execute('SELECT * FROM listings WHERE id = ? FOR UPDATE', [listingId]);
    const listing = listings[0];
    if (!listing || listing.status !== 'active' || listing.moderation_status !== 'approved') {
      throw httpError(404, 'This listing is not available.');
    }
    if (listing.listing_type !== 'auction') throw httpError(400, 'This listing is not an auction.');
    if (listing.auction_end_at && new Date(listing.auction_end_at) <= new Date()) throw httpError(400, 'This auction has ended.');
    if (await isBoutiqueSeller(profile.id, listing.boutique_id)) throw httpError(403, 'You cannot bid on your own listing.');

    if (action === 'place_bid') {
      if (listing.auction_mode === 'DUTCH') throw httpError(400, 'Dutch auctions are claimed at the current price.');
      const amount = Number(bidAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Enter a valid bid amount.');
      const [bids] = await connection.execute(
        'SELECT MAX(amount) AS current_bid FROM bids WHERE listing_id = ?',
        [listingId],
      );
      const currentBid = Number(bids[0].current_bid || listing.price);
      const minimumIncrement = Number(listing.increment_step) > 0
        ? Number(listing.increment_step)
        : currentBid < 50 ? 1 : currentBid < 200 ? 5 : currentBid < 500 ? 10 : currentBid < 1000 ? 25 : 50;
      if (amount < currentBid + minimumIncrement) {
        await connection.rollback();
        transactionStarted = false;
        return res.json({
          success: false,
          min_next_bid: currentBid + minimumIncrement,
          new_current_bid: currentBid,
          message: `Minimum bid is ${currentBid + minimumIncrement}.`,
        });
      }
      await connection.execute('UPDATE bids SET is_winning = 0 WHERE listing_id = ?', [listingId]);
      await connection.execute(
        'INSERT INTO bids (id, listing_id, bidder_id, amount, is_winning) VALUES (?, ?, ?, ?, 1)',
        [crypto.randomUUID(), listingId, profile.id, amount],
      );
      await connection.commit();
      transactionStarted = false;
      return res.json({ success: true, min_next_bid: amount + minimumIncrement, new_current_bid: amount, message: 'Bid placed successfully.' });
    }

    if (action === 'claim_dutch') {
      if (listing.auction_mode !== 'DUTCH') throw httpError(400, 'This is not a Dutch auction.');
      const price = Number(listing.current_dutch_price ?? listing.auction_start_price ?? listing.price);
      if (!Number.isFinite(price) || price <= 0) throw httpError(400, 'This auction has an invalid current price.');
      const orderId = crypto.randomUUID();
      await connection.execute(
        'INSERT INTO orders (id, buyer_id, listing_id, boutique_id, amount, status) VALUES (?, ?, ?, ?, ?, "escrow_held")',
        [orderId, profile.id, listing.id, listing.boutique_id, price],
      );
      await connection.execute('UPDATE listings SET status = "sold" WHERE id = ?', [listing.id]);
      await connection.commit();
      transactionStarted = false;
      return res.json({ success: true, order_id: orderId });
    }
    throw httpError(400, 'Unknown auction action.');
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

app.post('/api/checkout', async (req, res, next) => {
  let connection;
  let transactionStarted = false;
  try {
    connection = await pool.getConnection();
    const profile = requireUser(req);
    const { items, shipping_address: shippingAddress, voucher_code: voucherCode } = req.body;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw httpError(400, 'The cart is empty or invalid.');
    await connection.beginTransaction();
    transactionStarted = true;

    const listingIds = [...new Set(items.map((item) => item.listing_id))];
    if (listingIds.length !== items.length) throw httpError(400, 'A listing appears more than once in the cart.');
    const [listings] = await connection.execute(
      `SELECT * FROM listings WHERE id IN (${listingIds.map(() => '?').join(', ')}) FOR UPDATE`,
      listingIds,
    );
    if (listings.length !== items.length) throw httpError(409, 'One or more cart items are no longer available.');
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    let subtotal = 0;
    for (const item of items) {
      const listing = byId.get(item.listing_id);
      if (!listing || listing.status !== 'active' || listing.moderation_status !== 'approved') {
        throw httpError(409, 'One or more cart items are no longer available.');
      }
      if (Number(item.amount) !== Number(listing.price)) throw httpError(409, 'An item price changed. Refresh your cart.');
      subtotal += Number(listing.price);
    }

    let voucher = null;
    let discount = 0;
    if (voucherCode) {
      const [vouchers] = await connection.execute('SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?) FOR UPDATE', [String(voucherCode)]);
      voucher = vouchers[0];
      if (!voucher || voucher.status !== 'ACTIVE' || voucher.expires_at && new Date(voucher.expires_at) <= new Date()) {
        throw httpError(400, 'The voucher is invalid or expired.');
      }
      if (voucher.max_uses !== null && voucher.uses >= voucher.max_uses) throw httpError(400, 'This voucher has reached its usage limit.');
      const [usage] = await connection.execute('SELECT COUNT(*) AS uses FROM voucher_redemptions WHERE voucher_id = ? AND user_id = ?', [voucher.id, profile.id]);
      if (usage[0].uses >= voucher.max_uses_per_user) throw httpError(400, 'You have already used this voucher.');
      if (subtotal < Number(voucher.min_spend)) throw httpError(400, `Minimum spend of ${voucher.min_spend} required.`);
      if (listings.some((listing) => listing.listing_type === 'auction') && !voucher.auction_eligible) throw httpError(400, 'This voucher does not apply to auction items.');
      if (voucher.scope === 'BOUTIQUE' && listings.some((listing) => listing.boutique_id !== voucher.boutique_id)) throw httpError(400, 'This voucher does not apply to all cart items.');
      if (voucher.scope === 'CATEGORY' && listings.some((listing) => listing.category !== voucher.category)) throw httpError(400, 'This voucher does not apply to all cart items.');
      discount = voucher.discount_type === 'PERCENTAGE'
        ? subtotal * Number(voucher.discount_value) / 100
        : Math.min(Number(voucher.discount_value), subtotal);
    }

    const orderIds = [];
    for (const listing of listings) {
      const orderId = crypto.randomUUID();
      orderIds.push(orderId);
      await connection.execute(
        'INSERT INTO orders (id, buyer_id, listing_id, boutique_id, amount, status, shipping_address) VALUES (?, ?, ?, ?, ?, "escrow_held", ?)',
        [orderId, profile.id, listing.id, listing.boutique_id, Number(listing.price), String(shippingAddress || '').slice(0, 2000)],
      );
      await connection.execute('UPDATE listings SET status = "sold" WHERE id = ?', [listing.id]);
    }
    if (voucher) {
      await connection.execute('UPDATE vouchers SET uses = uses + 1 WHERE id = ?', [voucher.id]);
      await connection.execute(
        'INSERT INTO voucher_redemptions (id, voucher_id, user_id, order_id, cart_total_at_redemption, discount_amount) VALUES (?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), voucher.id, profile.id, orderIds[0], subtotal, discount],
      );
    }
    await connection.commit();
    transactionStarted = false;
    res.json({ success: true, order_ids: orderIds, discount_amount: discount });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

const signedUploads = new Map();
app.post('/api/storage/signed-url', async (req, res, next) => {
  try {
    requireUser(req);
    const fileName = `${crypto.randomUUID()}.jpg`;
    const expires = Date.now() + 10 * 60 * 1000;
    const signature = crypto.createHmac('sha256', tokenSecret).update(`${fileName}:${expires}`).digest('hex');
    signedUploads.set(fileName, { expires, signature });
    res.json({ signedUrl: `/api/storage/upload/${fileName}?expires=${expires}&signature=${signature}`, publicUrl: `/uploads/${fileName}` });
  } catch (error) {
    next(error);
  }
});

app.put('/api/storage/upload/:fileName', express.raw({ type: 'image/jpeg', limit: '10mb' }), async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const authorization = signedUploads.get(fileName);
    if (!authorization || authorization.expires < Date.now() ||
      req.query.expires !== String(authorization.expires) || req.query.signature !== authorization.signature) {
      signedUploads.delete(fileName);
      throw httpError(403, 'Upload link is invalid or expired.');
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, 'Upload an image/jpeg file.');
    await fs.mkdir(uploadsDirectory, { recursive: true });
    await fs.writeFile(path.join(uploadsDirectory, fileName), req.body, { flag: 'wx' });
    signedUploads.delete(fileName);
    res.status(201).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: process.env.MYSQL_DATABASE || 'thrifysync' });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error.' });
});

await pool.query('SELECT 1');
const [tableRows] = await pool.execute(
  'SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = "profiles"',
);
if (!tableRows[0].count) {
  console.error('MariaDB is connected, but the selected database has no ThriftSync schema. Import database/thrifysync.sql first.');
  process.exit(1);
}
await pool.execute(`
  CREATE TABLE IF NOT EXISTS app_users (
    id CHAR(36) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_salt CHAR(32) NOT NULL,
    password_hash CHAR(128) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_users_email (email),
    CONSTRAINT fk_app_users_profile FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

app.listen(port, '127.0.0.1', () => {
  console.log(`ThriftSync MariaDB API ready on http://127.0.0.1:${port}`);
});

// server/controllers/tripController.js
const Trip = require('../models/Trip');

// ================== Yardımcılar ==================
function nowISO() { return new Date(); }

// ================== CRUD ==================
exports.createTrip = async (req, res) => {
  try {
    const body = req.body || {};
    const userId = req.userId || null;

    // _id client'tan gelmemişse Mongo kendi ObjectId oluşturur (uygun)
    const doc = await Trip.create({
      ...body,
      userId,
      version: 1,
      updatedAt: nowISO(),
      deleted: !!body.deleted,
    });
    res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'id_conflict' });
    console.error('createTrip error:', e);
    res.status(500).json({ error: 'create_failed' });
  }
};

exports.getAllTrips = async (req, res) => {
  try {
    const userId = req.userId || null;
    const since = req.query.since ? new Date(req.query.since) : null;

    const q = userId ? { userId } : {};
    if (since) q.updatedAt = { $gt: since };

    const rows = await Trip.find(q).lean();
    res.json(rows);
  } catch (e) {
    console.error('getAllTrips error:', e);
    res.status(500).json({ error: 'list_failed' });
  }
};

exports.getTripById = async (req, res) => {
  try {
    const userId = req.userId || null;
    const id = req.params.id;
    const q = { _id: id };
    if (userId) q.userId = userId;
    const row = await Trip.findOne(q).lean();
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    console.error('getTripById error:', e);
    res.status(500).json({ error: 'get_failed' });
  }
};

exports.updateTrip = async (req, res) => {
  try {
    const userId = req.userId || null;
    const id = req.params.id;

    const expectedVersion = Number(req.header('if-match-version') || req.body?.version);
    if (!Number.isFinite(expectedVersion)) {
      return res.status(400).json({ error: 'missing_version' });
    }

    const update = { ...req.body };
    delete update.version; delete update.updatedAt; delete update.userId; delete update._id;

    const q = { _id: id };
    if (userId) q.userId = userId;

    const result = await Trip.findOneAndUpdate(
      { ...q, version: expectedVersion },
      { $set: { ...update, userId }, $inc: { version: 1 }, updatedAt: nowISO() },
      { new: true }
    );

    if (!result) return res.status(409).json({ error: 'version_conflict' });
    res.json(result);
  } catch (e) {
    console.error('updateTrip error:', e);
    res.status(500).json({ error: 'update_failed' });
  }
};

exports.softDeleteTrip = async (req, res) => {
  try {
    const userId = req.userId || null;
    const id = req.params.id;
    const q = { _id: id };
    if (userId) q.userId = userId;

    const result = await Trip.findOneAndUpdate(
      { ...q, deleted: { $ne: true } },
      { $set: { deleted: true, updatedAt: nowISO() }, $inc: { version: 1 } },
      { new: true }
    );
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  } catch (e) {
    console.error('softDeleteTrip error:', e);
    res.status(500).json({ error: 'delete_failed' });
  }
};

// ================== Delta Sync ==================
exports.syncTrips = async (req, res) => {
  try {
    const userId = req.userId || null;
    const { since, changes } = req.body || {};
    const applied = [];
    const conflicts = [];

    // 1) İstemciden gelen değişiklikleri uygula
    for (const ch of (changes || [])) {
      try {
        if (ch.type === 'upsert') {
          const expected = Number(ch.expectedVersion ?? 0);
          const data = { ...ch.data, userId };

          const found = await Trip.findOne({ _id: data._id, ...(userId ? { userId } : {}) });

          if (!found) {
            await Trip.create({ ...data, version: 1, updatedAt: nowISO() });
            applied.push({ id: data._id, op: 'insert' });
          } else if (found.version === expected) {
            const next = { ...data };
            delete next.version; delete next.updatedAt; delete next.userId; delete next._id;

            const upd = await Trip.findOneAndUpdate(
              { _id: found._id, ...(userId ? { userId } : {}), version: expected },
              { $set: next, $inc: { version: 1 }, updatedAt: nowISO() },
              { new: true }
            );
            if (!upd) conflicts.push({ id: data._id, reason: 'version_conflict' });
            else applied.push({ id: data._id, op: 'update' });
          } else {
            conflicts.push({ id: data._id, reason: 'version_conflict' });
          }
        } else if (ch.type === 'delete') {
          const id = ch.id;
          const f = await Trip.findOneAndUpdate(
            { _id: id, ...(userId ? { userId } : {}), deleted: { $ne: true } },
            { $set: { deleted: true, updatedAt: nowISO() }, $inc: { version: 1 } },
            { new: true }
          );
          applied.push({ id, op: 'delete', existed: !!f });
        }
      } catch (e) {
        conflicts.push({ id: ch?.data?._id || ch?.id, reason: 'server_error' });
      }
    }

    // 2) Sunucudan delta dön
    const deltaQuery = { ...(userId ? { userId } : {}) };
    if (since) deltaQuery.updatedAt = { $gt: new Date(since) };
    const delta = await Trip.find(deltaQuery).lean();

    res.json({
      applied,
      conflicts,
      serverChanges: delta,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    console.error('syncTrips error:', e);
    res.status(500).json({ error: 'sync_failed' });
  }
};

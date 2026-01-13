// server/controllers/tripController.js
const Trip = require('../models/Trip'); // ✅ doğru path (controllers -> models)

// ================== Helpers ==================
function nowDate() {
  return new Date(); // ✅ Date olarak sakla
}

// client hem id hem _id gönderebilir → normalize
function normalizeId(body = {}) {
  const b = { ...(body || {}) };
  if (!b._id && b.id) b._id = String(b.id);
  delete b.id;
  return b;
}

function parseSince(sinceRaw) {
  if (!sinceRaw) return null;
  const d = new Date(sinceRaw);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ================== CRUD ==================
exports.createTrip = async (req, res) => {
  try {
    const body0 = req.body || {};
    const userId = req.userId || null;

    const body = normalizeId(body0);

    const doc = await Trip.create({
      ...body,
      userId,
      version: 1,
      updatedAt: nowDate(),
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
    const since = parseSince(req.query.since);

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

    const body0 = req.body || {};
    const body = normalizeId(body0);

    const update = { ...body };
    delete update.version;
    delete update.updatedAt;
    delete update.userId;
    delete update._id; // path zaten id’den geliyor

    const q = { _id: id };
    if (userId) q.userId = userId;

    const result = await Trip.findOneAndUpdate(
      { ...q, version: expectedVersion },
      {
        $set: { ...update, userId, updatedAt: nowDate() },
        $inc: { version: 1 },
      },
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
      {
        $set: { deleted: true, updatedAt: nowDate() },
        $inc: { version: 1 },
      },
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

    for (const ch of (changes || [])) {
      try {
        if (ch.type === 'upsert') {
          const expected = ch.expectedVersion == null ? null : Number(ch.expectedVersion);
          const data0 = normalizeId(ch.data || {});
          const data = { ...data0, userId };

          if (!data._id) {
            conflicts.push({ id: ch?.data?._id || ch?.data?.id, reason: 'missing_id' });
            continue;
          }

          const found = await Trip.findOne({ _id: data._id, ...(userId ? { userId } : {}) });

          if (!found) {
            await Trip.create({ ...data, version: 1, updatedAt: nowDate() });
            applied.push({ id: data._id, op: 'insert' });
          } else {
            if (expected == null) {
              conflicts.push({ id: data._id, reason: 'missing_expectedVersion' });
              continue;
            }

            if (found.version === expected) {
              const next = { ...data };
              delete next.version;
              delete next.updatedAt;
              delete next.userId;
              delete next._id;

              const upd = await Trip.findOneAndUpdate(
                { _id: found._id, ...(userId ? { userId } : {}), version: expected },
                {
                  $set: { ...next, updatedAt: nowDate() },
                  $inc: { version: 1 },
                },
                { new: true }
              );

              if (!upd) conflicts.push({ id: data._id, reason: 'version_conflict' });
              else applied.push({ id: data._id, op: 'update' });
            } else {
              conflicts.push({ id: data._id, reason: 'version_conflict' });
            }
          }
        } else if (ch.type === 'delete') {
          const id = String(ch.id || '');

          const f = await Trip.findOneAndUpdate(
            { _id: id, ...(userId ? { userId } : {}), deleted: { $ne: true } },
            {
              $set: { deleted: true, updatedAt: nowDate() },
              $inc: { version: 1 },
            },
            { new: true }
          );

          applied.push({ id, op: 'delete', existed: !!f });
        }
      } catch (e) {
        conflicts.push({ id: ch?.data?._id || ch?.data?.id || ch?.id, reason: 'server_error' });
      }
    }

    const sinceDate = parseSince(since);
    const deltaQuery = { ...(userId ? { userId } : {}) };
    if (sinceDate) deltaQuery.updatedAt = { $gt: sinceDate };

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

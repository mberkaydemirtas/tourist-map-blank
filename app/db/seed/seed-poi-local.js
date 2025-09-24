// app/db/seed/seed-poi-local.js
import { mapCsvRowCategory } from '../../trips/components/TripListQuestion';
const Papa = require('papaparse');
const FileSystem = require('expo-file-system');
const { getDB } = require('../../lib/db');

// Aynı normalize fonksiyonu (Türkçe karakterleri sadeleştirme)
function normalize(s = "") {
  return s.normalize?.('NFKD')
    ?.replace(/[\u0300-\u036f]/g, '')
    ?.replace(/[İIı]/g, 'i')
    ?.replace(/Ş/g, 's').replace(/ş/g, 's')
    ?.replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    ?.replace(/Ü/g, 'u').replace(/ü/g, 'u')
    ?.replace(/Ö/g, 'o').replace(/ö/g, 'o')
    ?.replace(/Ç/g, 'c').replace(/ç/g, 'c')
    ?.toLowerCase()
    ?.trim() ?? s.toLowerCase();
}

// Main seeding function
async function seedPOIFromCSV(csvAssetUri) {
  const db = await getDB();
  const csv = await FileSystem.readAsStringAsync(csvAssetUri, { encoding: 'utf8' });

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const rows = Array.isArray(parsed.data) ? parsed.data : [];

  // Hazırlanmış ifade + batch insert (ör. 500’lük)
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const tx = await db.transactionAsync();
    try {
      for (const r of chunk) {
        const city = String(r.province || r.city || '').trim();
        const name = String(r.name || r.title || '(isimsiz)');
        const lat = Number(r.lat);
        const lon = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        // category mapping (senin mapCsvRowCategory ile aynı mantık)
        const cat = mapCsvRowCategory(r); // <-- bu fonksiyonu require ile import etmen lazım

        await tx.executeSqlAsync(
          `INSERT OR REPLACE INTO poi(id,country,city,category,name,nameNorm,lat,lon,address)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [
            String(r.id || `csv_${i}`),
            'TR',
            city,
            cat,
            name,
            normalize(name),
            lat,
            lon,
            String(r.address || ''),
          ]
        );
      }
      await tx.commitAsync();
    } catch (e) {
      await tx.rollbackAsync();
      throw e;
    }
  }
}

module.exports = {
  seedPOIFromCSV
};

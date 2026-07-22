import { json } from '@sveltejs/kit';
import jwt from 'jsonwebtoken';
import { query } from '$lib/server/db.js';
import { extractEmbedding, getDistance } from '$lib/server/face.js';
import { env } from '$env/dynamic/private';

function getDistanceBetweenPoints(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const f1 = lat1 * Math.PI/180;
  const f2 = lat2 * Math.PI/180;
  const df = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(df/2) * Math.sin(df/2) +
            Math.cos(f1) * Math.cos(f2) *
            Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export async function POST({ request }) {
  try {
    const { planarArray, qrToken, eventId: bodyEventId, latitude, longitude, offlineUuid, timestamp } = await request.json();
    
    if (!planarArray) {
      return json({ error: 'Face scan planar array data is required' }, { status: 400 });
    }

    // 1. Backend Face Recognition (ArcFace)
    const embedding = await extractEmbedding(planarArray);

    // Fetch all users with face models
    const usersResult = await query("SELECT id, name, role, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND face_descriptor != '[]'");
    
    let matchedUser = null;
    let minDistance = 1.25; // Relaxed ArcFace Euclidean distance matching threshold (1.25 is standard and robust)

    let legacyDescriptorsFound = 0;
    let activeDescriptorsCount = 0;

    for (const u of usersResult.rows) {
      try {
        const userEmb = JSON.parse(u.face_descriptor);
        if (Array.isArray(userEmb)) {
          if (userEmb.length === 512) {
            activeDescriptorsCount++;
            const dist = getDistance(embedding, userEmb);
            console.log(`DEBUG FACE MATCH: user="${u.name}", dist=${dist.toFixed(4)}, threshold=${minDistance}`);
            if (dist < minDistance) {
              minDistance = dist;
              matchedUser = u;
            }
          } else if (userEmb.length === 128) {
            legacyDescriptorsFound++;
          }
        }
      } catch (err) {
        console.warn('Failed to parse face descriptor for user:', u.id, err);
      }
    }

    if (!matchedUser) {
      console.log(`DEBUG FACE MATCH: No match found. active_512d_count=${activeDescriptorsCount}, legacy_128d_count=${legacyDescriptorsFound}`);
      if (activeDescriptorsCount === 0 && legacyDescriptorsFound > 0) {
        return json({ 
          error: 'Face not recognized. Legacy face data (128-D) is incompatible with the new ArcFace model (512-D). Please register or re-scan your face.' 
        }, { status: 400 });
      }
      return json({ error: 'Face not recognized. Please scan again or register first.' }, { status: 400 });
    }

    const userId = matchedUser.id;

    // 2. Offline duplicate check
    if (offlineUuid) {
      const existing = await query('SELECT id FROM attendance WHERE offline_uuid = $1', [offlineUuid]);
      if (existing.rows.length > 0) {
        return json({ success: true, type: 'sync', message: 'Record already synced (duplicate ignored)' });
      }
    }

    const checkInTime = timestamp ? new Date(timestamp) : new Date();
    const today = checkInTime.toISOString().split('T')[0];
    let eventId = bodyEventId || null;

    // 3. QR code token validation
    if (qrToken) {
      if (qrToken.includes('.')) {
        const secret = env.JWT_SECRET || env.SESSION_SECRET || 'secret';
        let decoded;
        try {
          decoded = jwt.verify(qrToken, secret, { ignoreExpiration: true });
          eventId = decoded.eventId;
          
          const tokenExp = decoded.exp * 1000;
          const tokenIat = decoded.iat * 1000;
          const tolerance = 60000; // 60 seconds clock drift tolerance
          if (checkInTime.getTime() > tokenExp + tolerance || checkInTime.getTime() < tokenIat - tolerance) {
            return json({ error: 'QR Code expired or invalid for this time' }, { status: 400 });
          }
        } catch (err) {
          return json({ error: 'Invalid QR signature' }, { status: 400 });
        }
      } else {
        // Raw event ID QR code
        eventId = parseInt(qrToken);
        if (isNaN(eventId)) {
          return json({ error: 'Invalid event QR format' }, { status: 400 });
        }
      }
    }

    // 4. Proximity Check
    if (eventId && latitude !== undefined && longitude !== undefined) {
      const eventResult = await query('SELECT latitude, longitude, radius_meters FROM events WHERE id = $1', [eventId]);
      if (eventResult.rows.length > 0) {
        const event = eventResult.rows[0];
        const dist = getDistanceBetweenPoints(latitude, longitude, event.latitude, event.longitude);
        if (dist > event.radius_meters) {
          return json({ error: `Out of range. Distance: ${Math.round(dist)}m, Max: ${event.radius_meters}m` }, { status: 400 });
        }
      }
    }

    // 5. Check-in/out type auto-determination
    let finalType = 'in';
    const lastRecord = await query(
      'SELECT id FROM attendance WHERE user_id = $1 AND date = $2 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
      [userId, today]
    );

    if (lastRecord.rows.length > 0) {
      finalType = 'out';
      await query(
        'UPDATE attendance SET check_out = $1, latitude = $2, longitude = $3, offline_uuid = COALESCE($4, offline_uuid) WHERE id = $5',
        [checkInTime, latitude, longitude, offlineUuid || null, lastRecord.rows[0].id]
      );
    } else {
      finalType = 'in';
      await query(
        'INSERT INTO attendance (user_id, check_in, date, event_id, latitude, longitude, offline_uuid) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [userId, checkInTime, today, eventId, latitude, longitude, offlineUuid || null]
      );
    }

    return json({ success: true, type: finalType, user: { id: matchedUser.id, name: matchedUser.name } });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

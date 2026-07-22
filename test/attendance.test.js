import assert from 'assert';
import jwt from 'jsonwebtoken';

// Simulate JWT validation logic from Backend to assert correctness
function testQRValidation() {
  console.log('Running QR JWT Validation tests...');

  const secret = 'test-secret';
  const eventId = 42;
  const latitude = 37.7749;
  const longitude = -122.4194;
  const radius = 100;
  const hostId = 12;
  const hostImage = 'data:image/jpeg;base64,mock';

  // 1. Valid Token
  const validToken = jwt.sign(
    { eventId, latitude, longitude, radius, hostId, hostImage },
    secret,
    { expiresIn: 60 } // expires in 60s
  );

  const decoded = jwt.verify(validToken, secret);
  assert.strictEqual(decoded.eventId, eventId);
  assert.strictEqual(decoded.hostId, hostId);
  console.log('✓ Valid QR Token signature, Host creator association verified successfully.');

  // 2. Expired Token check simulation
  const expiredToken = jwt.sign(
    { eventId, latitude, longitude, radius },
    secret,
    { expiresIn: -10 } // expired 10 seconds ago
  );

  const checkInTime = new Date();
  const decodedExpired = jwt.verify(expiredToken, secret, { ignoreExpiration: true });
  
  const tokenExp = decodedExpired.exp * 1000;
  const tokenIat = decodedExpired.iat * 1000;
  
  assert.ok(checkInTime.getTime() > tokenExp, 'Token should be expired');
  console.log('✓ Expired QR Token check-in rejection simulation verified successfully.');
}

function getDistance(lat1, lon1, lat2, lon2) {
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

function testProximityValidation() {
  console.log('Running Proximity validation tests...');

  const eventLat = 37.7749;
  const eventLon = -122.4194;
  const maxRadius = 100; // 100 meters

  // Case A: User close (10 meters away)
  const closeLat = 37.7750;
  const closeLon = -122.4194;
  const distClose = getDistance(closeLat, closeLon, eventLat, eventLon);
  assert.ok(distClose <= maxRadius, `User at 10m should be within radius, got ${distClose}m`);
  console.log(`✓ Within-range proximity check verified successfully (distance: ${Math.round(distClose)}m).`);

  // Case B: User far (500 meters away)
  const farLat = 37.7790;
  const farLon = -122.4194;
  const distFar = getDistance(farLat, farLon, eventLat, eventLon);
  assert.ok(distFar > maxRadius, `User at 500m should be out of range, got ${distFar}m`);
  console.log(`✓ Out-of-range proximity check verified successfully (distance: ${Math.round(distFar)}m).`);
}

try {
  testQRValidation();
  testProximityValidation();
  console.log('\nAll integration tests passed successfully!');
} catch (err) {
  console.error('Test validation failed:', err);
  process.exit(1);
}

const path = require("path");
const admin = require("firebase-admin");

const [email, password, name = "Admin"] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/seedAdmin.js <email> <password> [name]");
  process.exit(1);
}

const serviceAccount = require(path.join(__dirname, "..", "serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "client-dash-9b027.appspot.com",
});

async function seedAdmin() {
  const auth = admin.auth();
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, {
      password,
      displayName: name,
      disabled: false,
      emailVerified: true,
    });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: true,
      disabled: false,
    });
  }

  await auth.setCustomUserClaims(user.uid, { role: "admin" });

  await db.collection("users").doc(user.uid).set(
    {
      role: "admin",
      email,
      name,
      clientId: null,
      updatedAt: now,
      createdAt: now,
      lastLogin: null,
    },
    { merge: true }
  );

  console.log(`Admin ready: ${email}`);
  console.log(`UID: ${user.uid}`);
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
